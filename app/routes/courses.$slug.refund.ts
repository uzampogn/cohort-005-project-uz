import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses, refunds, users, RefundStatus } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
<<<<<<< HEAD
<<<<<<< HEAD
import { getRefundEligibility } from "~/lib/refunds.server";
import {
  buildRefundRequestEmail,
  REFUND_ALREADY_RAISED_REASON,
} from "~/lib/refunds";
import Database from "better-sqlite3";
=======
=======
>>>>>>> 13465da (create-glossary-and-fix-refund-drift: Create the glossary and rename to Refund)
import { formatPrice } from "~/lib/utils";

const REFUND_WINDOW_DAYS = 14;
const MAX_WATCHED_HOURS = 2;
>>>>>>> 13465da (create-glossary-and-fix-refund-drift: Create the glossary and rename to Refund)

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

<<<<<<< HEAD
// better-sqlite3 throws SqliteError directly; drizzle may wrap it as `cause`.
function isUniqueConstraintViolation(error: unknown): boolean {
  const candidates = [error, error instanceof Error ? error.cause : undefined];
  return candidates.some(
    (candidate) =>
      candidate instanceof Database.SqliteError &&
      candidate.code === "SQLITE_CONSTRAINT_UNIQUE"
  );
=======
function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

function getLessonIdsForCourse(courseId: number): number[] {
  const rows = db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all();

  return rows.map((row) => row.id);
}

function getOpenRefundRequest(purchaseId: number) {
  return db
    .select()
    .from(refunds)
    .where(
      and(
        eq(refunds.purchaseId, purchaseId),
        eq(refunds.status, RefundStatus.Open)
      )
    )
    .get();
}

// The fourteen-day window is counted in whole days, not hours — someone who
// buys at 23:00 should still get the whole of their fourteenth day.
function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

function lastDayOfWindow(purchasedAtIso: string): string {
  const deadline = new Date(purchasedAtIso);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  return calendarDay(deadline);
}

/**
 * The confirmation the learner gets in their inbox. There is no mail
 * transport wired up yet, so the built message goes to the server log.
 */
function buildRefundRequestEmail(input: {
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  amount: number;
}) {
  return {
    to: input.learnerEmail,
    subject: `Refund requested — ${input.courseTitle}`,
    body: [
      `Hi ${input.learnerName},`,
      "",
      `We have your refund request for "${input.courseTitle}".`,
      `The refund is for ${formatPrice(input.amount)}, the amount you paid.`,
      "",
      "Our team reviews every refund request by hand. You do not need to do anything else — we will email you again when it is done.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
>>>>>>> 13465da (create-glossary-and-fix-refund-drift: Create the glossary and rename to Refund)
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

<<<<<<< HEAD
<<<<<<< HEAD
  const { purchase, eligibility } = refundCheck;

  if (!eligibility.eligible) {
    throw data(eligibility.reason, { status: 403 });
  }

=======
=======
>>>>>>> 13465da (create-glossary-and-fix-refund-drift: Create the glossary and rename to Refund)
  if (getOpenRefundRequest(purchase.id)) {
    throw data("You already have an open refund request on this purchase.", {
      status: 409,
    });
  }

  // A seat that came out of a team licence, and has been claimed, belongs to
  // the team — the learner cannot hand it back on their own.
  const claimedSeat = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchase.id), isNotNull(coupons.redeemedAt))
    )
    .get();

  if (claimedSeat) {
    throw data("A claimed team seat cannot be refunded.", { status: 403 });
  }

  const today = calendarDay(new Date());
  const withinRefundWindow = today <= lastDayOfWindow(purchase.createdAt);

  if (!withinRefundWindow) {
    throw data(`The ${REFUND_WINDOW_DAYS}-day window has closed.`, {
      status: 403,
    });
  }

  const courseLessonIds = getLessonIdsForCourse(course.id);

  let watchedSeconds = 0;
  if (courseLessonIds.length > 0) {
    const furthestPerLesson = db
      .select({
        furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
      })
      .from(videoWatchEvents)
      .where(
        and(
          eq(videoWatchEvents.userId, currentUserId),
          inArray(videoWatchEvents.lessonId, courseLessonIds)
        )
      )
      .groupBy(videoWatchEvents.lessonId)
      .all();

    watchedSeconds = furthestPerLesson.reduce(
      (total, row) => total + row.furthest,
      0
    );
  }

  if (watchedSeconds >= MAX_WATCHED_HOURS * 60 * 60) {
    throw data("You have watched too much of this course to request a refund.", {
      status: 403,
    });
  }

<<<<<<< HEAD
>>>>>>> 13465da (create-glossary-and-fix-refund-drift: Create the glossary and rename to Refund)
=======
>>>>>>> 13465da (create-glossary-and-fix-refund-drift: Create the glossary and rename to Refund)
  const formData = await request.formData();
  const parsed = parseFormData(formData, refundActionSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

<<<<<<< HEAD
  // The eligibility check above can race a second submission; the unique
  // index on refunds.purchase_id is what actually holds the line.
  try {
    db.insert(refunds)
      .values({
        purchaseId: purchase.id,
        status: RefundStatus.Requested,
        reason: parsed.data.reason,
      })
      .run();
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw data(REFUND_ALREADY_RAISED_REASON, { status: 403 });
    }
    throw error;
  }
=======
  db
    .insert(refunds)
    .values({
      purchaseId: purchase.id,
      status: RefundStatus.Open,
      reason: parsed.data.reason,
    })
    .returning()
    .get();
>>>>>>> 13465da (create-glossary-and-fix-refund-drift: Create the glossary and rename to Refund)

  const email = buildRefundRequestEmail({
    learnerName: learner.name,
    learnerEmail: learner.email,
    courseTitle: course.title,
<<<<<<< HEAD
<<<<<<< HEAD
    amount: eligibility.amount,
=======
    amount: purchase.amountPaid,
>>>>>>> 13465da (create-glossary-and-fix-refund-drift: Create the glossary and rename to Refund)
=======
    amount: purchase.amountPaid,
>>>>>>> 13465da (create-glossary-and-fix-refund-drift: Create the glossary and rename to Refund)
  });

  console.log(
    `[email] to=${email.to} subject=${email.subject}\n${email.body}`
  );

  return redirect("/settings");
}
