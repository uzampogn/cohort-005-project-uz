import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { and, asc, desc, eq, isNotNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { data, isRouteErrorResponse, Link } from "react-router";
import { AlertTriangle, ReceiptText } from "lucide-react";
import type { Route } from "./+types/admin.refunds";
import { db } from "~/db";
import {
  RefundStatus,
  coupons,
  courses,
  enrollments,
  purchases,
  refunds,
  users,
} from "~/db/schema";
import { requireAdmin } from "~/lib/access.server";
import {
  isOwnRefundRequest,
  resolveRefundRequest,
  type RefundRefusal,
} from "~/lib/refund-resolution";
import {
  buildRefundOutcomeEmail,
  compareRefundEvidence,
  daysSincePurchase,
  type EvidenceChange,
} from "~/lib/refunds";
import { getRefundEvidence, getSecondsWatched } from "~/lib/refunds.server";
import { formatPrice } from "~/lib/utils";
import { parseFormData } from "~/lib/validation";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

const refundActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("approve"),
    refundId: z.coerce.number().int(),
    // Internal only: the Learner never sees it.
    note: z.string().max(1000).optional(),
  }),
  z.object({
    intent: z.literal("decline"),
    refundId: z.coerce.number().int(),
    note: z.string(),
  }),
]);

function getOpenRefundRequests() {
  return db
    .select({
      id: refunds.id,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      purchasedAt: purchases.createdAt,
      secondsWatchedAtRequest: refunds.secondsWatchedAtRequest,
      lessonsCompletedAtRequest: refunds.lessonsCompletedAtRequest,
      totalLessonsAtRequest: refunds.totalLessonsAtRequest,
      amountPaid: purchases.amountPaid,
      learnerId: users.id,
      learnerName: users.name,
      learnerEmail: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.status, RefundStatus.Requested))
    .orderBy(asc(refunds.requestedAt))
    .all();
}

// Deciding your own Refund Request is forbidden, not a conflict.
const REFUSAL_STATUS: Record<RefundRefusal, number> = {
  "already-resolved": 409,
  "own-refund-request": 403,
  "missing-decline-note": 400,
};

const resolvers = alias(users, "resolvers");

const RECENTLY_DECIDED_LIMIT = 20;

function getRecentlyDecidedRefundRequests() {
  return db
    .select({
      id: refunds.id,
      status: refunds.status,
      resolvedAt: refunds.resolvedAt,
      amountRefunded: refunds.amountRefunded,
      declineNote: refunds.declineNote,
      internalNote: refunds.internalNote,
      learnerName: users.name,
      courseTitle: courses.title,
      resolvedByName: resolvers.name,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(resolvers, eq(refunds.resolvedByUserId, resolvers.id))
    .where(ne(refunds.status, RefundStatus.Requested))
    .orderBy(desc(refunds.resolvedAt))
    .limit(RECENTLY_DECIDED_LIMIT)
    .all();
}

function getRefundRequestForResolution(refundId: number) {
  return db
    .select({
      id: refunds.id,
      status: refunds.status,
      amountPaid: purchases.amountPaid,
      learnerId: purchases.userId,
      learnerName: users.name,
      learnerEmail: users.email,
      courseId: purchases.courseId,
      courseTitle: courses.title,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.id, refundId))
    .get();
}

function formatWatchTime(seconds: number) {
  if (seconds === 0) return "Nothing";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest}s`;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Approve or decline open Refund Requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { userId } = await requireAdmin(request);
  const now = new Date();

  const requests = getOpenRefundRequests().map((refundRequest) => {
    const {
      secondsWatchedAtRequest,
      lessonsCompletedAtRequest,
      totalLessonsAtRequest,
      ...rest
    } = refundRequest;

    // Refund Eligibility was judged when the Learner asked (see GLOSSARY.md).
    // Show what it was judged on beside the same measures now. Refund Requests
    // raised before the snapshot existed fall back to watch time measured as
    // of asking; lessons completed then can't be recovered.
    const judgedOn = {
      secondsWatched:
        secondsWatchedAtRequest ??
        Math.round(
          getSecondsWatched(refundRequest.learnerId, refundRequest.courseId, {
            asOf: refundRequest.requestedAt,
          })
        ),
      lessonsCompleted: lessonsCompletedAtRequest,
      totalLessons: totalLessonsAtRequest,
    };

    return {
      ...rest,
      isOwnRefundRequest: isOwnRefundRequest(refundRequest, userId),
      daysSincePurchase: {
        then: daysSincePurchase(
          new Date(refundRequest.purchasedAt),
          new Date(refundRequest.requestedAt)
        ),
        now: daysSincePurchase(new Date(refundRequest.purchasedAt), now),
      },
      evidence: compareRefundEvidence(
        judgedOn,
        getRefundEvidence(refundRequest.learnerId, refundRequest.courseId)
      ),
    };
  });

  return { requests, recentlyDecided: getRecentlyDecidedRefundRequests() };
}

export async function action({ request }: Route.ActionArgs) {
  const { userId } = await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundActionSchema);

  if (!parsed.success) {
    throw data(Object.values(parsed.errors)[0] ?? "Invalid input.", {
      status: 400,
    });
  }

  const refundRequest = getRefundRequestForResolution(parsed.data.refundId);
  if (!refundRequest) {
    throw data("Refund Request not found.", { status: 404 });
  }

  const resolvedAt = new Date().toISOString();
  const resolution = resolveRefundRequest(
    refundRequest,
    parsed.data.intent === "approve"
      ? {
          decision: "approve",
          note: parsed.data.note,
          resolvedByUserId: userId,
          resolvedAt,
        }
      : {
          decision: "decline",
          note: parsed.data.note,
          resolvedByUserId: userId,
          resolvedAt,
        }
  );

  if (!resolution.ok) {
    throw data(resolution.error, {
      status: REFUSAL_STATUS[resolution.kind],
    });
  }

  const { update } = resolution;

  const keepsAccessThroughTeamSeat = db.transaction((tx) => {
    // The status guard means a request resolved by someone else in the
    // meantime is left alone rather than overwritten.
    const updated = tx
      .update(refunds)
      .set(update)
      .where(
        and(
          eq(refunds.id, refundRequest.id),
          eq(refunds.status, RefundStatus.Requested)
        )
      )
      .returning({ id: refunds.id })
      .all();

    if (updated.length === 0) {
      throw data("This Refund Request has already been resolved.", {
        status: 409,
      });
    }

    // An approved Refund ends the access this Purchase gave. The Purchase,
    // progress and watch events stay as history.
    if (update.status === RefundStatus.Approved) {
      // The Learner may also hold the Course through a claimed Team Seat. That
      // seat belongs to the team, not to this Purchase, and both share one
      // Enrollment row, so in that case the Enrollment stays.
      const claimedTeamSeat = tx
        .select({ id: coupons.id })
        .from(coupons)
        .where(
          and(
            eq(coupons.courseId, refundRequest.courseId),
            eq(coupons.redeemedByUserId, refundRequest.learnerId),
            isNotNull(coupons.redeemedAt)
          )
        )
        .get();

      if (claimedTeamSeat) return true;

      tx.delete(enrollments)
        .where(
          and(
            eq(enrollments.userId, refundRequest.learnerId),
            eq(enrollments.courseId, refundRequest.courseId)
          )
        )
        .run();
    }

    return false;
  });

  const learner = {
    learnerName: refundRequest.learnerName,
    learnerEmail: refundRequest.learnerEmail,
    courseTitle: refundRequest.courseTitle,
  };
  const email = buildRefundOutcomeEmail(
    parsed.data.intent === "approve"
      ? {
          ...learner,
          outcome: "approved",
          amountRefunded: update.amountRefunded ?? refundRequest.amountPaid,
          keepsAccessThroughTeamSeat,
        }
      : { ...learner, outcome: "declined", declineNote: parsed.data.note }
  );

  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);

  return { resolved: update.status, keepsAccessThroughTeamSeat };
}

type OpenRefundRequest = Route.ComponentProps["loaderData"]["requests"][number];
type DecidedRefundRequest =
  Route.ComponentProps["loaderData"]["recentlyDecided"][number];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function EvidenceLine({
  label,
  change,
  format = String,
}: {
  label: string;
  change: EvidenceChange;
  format?: (value: number) => string;
}) {
  return (
    <li className={change.changed ? "font-medium text-amber-600" : undefined}>
      {label}:{" "}
      {change.then === null ? "not recorded" : format(change.then)}
      {change.changed && <> → {format(change.now)}</>}
    </li>
  );
}

function SinceAsking({ refundRequest }: { refundRequest: OpenRefundRequest }) {
  const { evidence, daysSincePurchase } = refundRequest;
  return (
    <div className="text-xs text-muted-foreground">
      {evidence.anyChanged && (
        <p className="mb-1 flex items-center gap-1 font-medium text-amber-600">
          <AlertTriangle className="size-3" /> Changed since asking
        </p>
      )}
      <ul className="space-y-0.5">
        <li>
          Asked {daysSincePurchase.then}{" "}
          {daysSincePurchase.then === 1 ? "day" : "days"} after buying (
          {daysSincePurchase.now} now)
        </li>
        <EvidenceLine
          label="Watched"
          change={evidence.secondsWatched}
          format={formatWatchTime}
        />
        <EvidenceLine label="Lessons completed" change={evidence.lessonsCompleted} />
        <EvidenceLine label="Lessons in course" change={evidence.totalLessons} />
      </ul>
    </div>
  );
}

function RefundRequestRow({
  refundRequest,
}: {
  refundRequest: OpenRefundRequest;
}) {
  const fetcher = useFetcher<typeof action>();
  const [deciding, setDeciding] = useState<"approve" | "decline" | null>(null);
  const [note, setNote] = useState("");
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    toast.success(
      fetcher.data.resolved !== RefundStatus.Approved
        ? "Refund Request declined."
        : fetcher.data.keepsAccessThroughTeamSeat
          ? "Refund approved. The Learner keeps access through a claimed Team Seat."
          : "Refund approved. The Learner no longer has access."
    );
  }, [fetcher.state, fetcher.data]);

  const requestedOn = formatDate(refundRequest.requestedAt);

  function stopDeciding() {
    setDeciding(null);
    setNote("");
  }

  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="px-4 py-3">
        <p className="text-sm font-medium">{refundRequest.learnerName}</p>
        <p className="text-xs text-muted-foreground">
          {refundRequest.learnerEmail}
        </p>
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/courses/${refundRequest.courseSlug}`}
          className="text-sm font-medium hover:underline"
        >
          {refundRequest.courseTitle}
        </Link>
      </td>
      <td className="px-4 py-3 text-sm">
        {formatPrice(refundRequest.amountPaid)}
      </td>
      <td className="max-w-xs px-4 py-3 text-sm whitespace-pre-wrap">
        {refundRequest.reason}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{requestedOn}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        <SinceAsking refundRequest={refundRequest} />
      </td>
      <td className="px-4 py-3">
        {refundRequest.isOwnRefundRequest ? (
          <p className="w-48 text-xs text-muted-foreground">
            This is your own Refund Request. Another Admin needs to decide it.
          </p>
        ) : deciding ? (
          <fetcher.Form method="post" className="flex w-64 flex-col gap-2">
            <input type="hidden" name="intent" value={deciding} />
            <input type="hidden" name="refundId" value={refundRequest.id} />
            <Textarea
              name="note"
              required={deciding === "decline"}
              placeholder={
                deciding === "decline"
                  ? "Why is this declined? The Learner will read this."
                  : "Internal note (optional). The Learner never sees this."
              }
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="flex gap-2">
              {deciding === "decline" ? (
                <Button
                  type="submit"
                  size="sm"
                  variant="destructive"
                  disabled={busy || note.trim() === ""}
                >
                  Decline
                </Button>
              ) : (
                <Button type="submit" size="sm" disabled={busy}>
                  Approve {formatPrice(refundRequest.amountPaid)}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={stopDeciding}
              >
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        ) : (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => setDeciding("approve")}
            >
              Approve…
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setDeciding("decline")}
            >
              Decline…
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

const COLUMNS = [
  "Learner",
  "Course",
  "Amount paid",
  "Reason",
  "Requested",
  "Since asking",
  "",
];

function RecentlyDecided({
  decided,
}: {
  decided: DecidedRefundRequest[];
}) {
  if (decided.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-1 text-xl font-semibold">Recently decided</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        The last {decided.length} decisions. Internal notes are for Admins only.
      </p>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {decided.map((refundRequest) => {
              const approved = refundRequest.status === RefundStatus.Approved;
              return (
                <li key={refundRequest.id} className="px-4 py-3 text-sm">
                  <p>
                    <span
                      className={
                        approved
                          ? "font-medium text-green-600"
                          : "font-medium text-destructive"
                      }
                    >
                      {approved ? "Approved" : "Declined"}
                    </span>{" "}
                    · {refundRequest.learnerName} · {refundRequest.courseTitle}
                    {approved && refundRequest.amountRefunded !== null && (
                      <> · {formatPrice(refundRequest.amountRefunded)}</>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {refundRequest.resolvedByName ?? "Unknown Admin"}
                    {refundRequest.resolvedAt &&
                      ` on ${formatDate(refundRequest.resolvedAt)}`}
                  </p>
                  {refundRequest.declineNote && (
                    <p className="mt-1 text-xs">
                      Note to the Learner: {refundRequest.declineNote}
                    </p>
                  )}
                  {refundRequest.internalNote && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Internal note: {refundRequest.internalNote}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { requests, recentlyDecided } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Approve or decline open Refund Requests. A decline needs a note and is
          final.
        </p>
      </div>

      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <ReceiptText className="size-4" />
        <span>
          {requests.length} open{" "}
          {requests.length === 1 ? "request" : "requests"}
        </span>
      </div>

      {requests.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <ReceiptText className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">No open Refund Requests.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {COLUMNS.map((column) => (
                      <th
                        key={column}
                        className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {requests.map((refundRequest) => (
                    <RefundRequestRow
                      key={refundRequest.id}
                      refundRequest={refundRequest}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <RecentlyDecided decided={recentlyDecided} />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading Refund Requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only admins can access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/admin/refunds">
            <Button>Back to Refund Requests</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
