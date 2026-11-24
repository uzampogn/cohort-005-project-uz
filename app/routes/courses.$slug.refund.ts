import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses, refunds, users, RefundStatus } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import { getRefundEligibility } from "~/lib/refunds.server";
import {
  buildRefundRequestEmail,
  REFUND_ALREADY_RAISED_REASON,
} from "~/lib/refunds";
import Database from "better-sqlite3";

const refundParamsSchema = z.object({
  slug: z.string().min(1),
});

const refundActionSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more about why you want a refund.")
    .max(1000, "Please keep your reason under 1000 characters."),
});

function getCourseBySlug(slug: string) {
  return db.select().from(courses).where(eq(courses.slug, slug)).get();
}

// better-sqlite3 throws SqliteError directly; drizzle may wrap it as `cause`.
function isUniqueConstraintViolation(error: unknown): boolean {
  const candidates = [error, error instanceof Error ? error.cause : undefined];
  return candidates.some(
    (candidate) =>
      candidate instanceof Database.SqliteError &&
      candidate.code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

export async function action({ params, request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in to request a refund.", { status: 401 });
  }

  const { slug } = parseParams(params, refundParamsSchema);
  const course = getCourseBySlug(slug);

  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const learner = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!learner) {
    throw data("User not found", { status: 404 });
  }

  const refundCheck = getRefundEligibility(currentUserId, course.id);

  if (!refundCheck) {
    throw data("You have not bought this course.", { status: 403 });
  }

  const { purchase, eligibility } = refundCheck;

  if (!eligibility.eligible) {
    throw data(eligibility.reason, { status: 403 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundActionSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  // The eligibility check above can race a second submission; the unique
  // index on refunds.purchase_id is what actually holds the line.
  try {
    db.insert(refunds)
      .values({
        purchaseId: purchase.id,
        status: RefundStatus.Requested,
        reason: parsed.data.reason,
        // What eligibility was judged on, so the Admin can see what changed.
        secondsWatchedAtRequest: eligibility.judgedOn.secondsWatched,
        lessonsCompletedAtRequest: eligibility.judgedOn.lessonsCompleted,
        totalLessonsAtRequest: eligibility.judgedOn.totalLessons,
      })
      .run();
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw data(REFUND_ALREADY_RAISED_REASON, { status: 403 });
    }
    throw error;
  }

  const email = buildRefundRequestEmail({
    learnerName: learner.name,
    learnerEmail: learner.email,
    courseTitle: course.title,
    amount: eligibility.amount,
  });

  console.log(
    `[email] to=${email.to} subject=${email.subject}\n${email.body}`
  );

  return redirect("/settings");
}
