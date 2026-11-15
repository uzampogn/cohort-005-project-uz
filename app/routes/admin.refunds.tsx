import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { data, isRouteErrorResponse, Link } from "react-router";
import { AlertTriangle, ReceiptText } from "lucide-react";
import type { Route } from "./+types/admin.refunds";
import { db } from "~/db";
import {
  RefundStatus,
  courses,
  enrollments,
  purchases,
  refunds,
  users,
} from "~/db/schema";
import { requireAdmin } from "~/lib/access.server";
import { resolveRefundRequest } from "~/lib/refund-resolution";
import { buildRefundOutcomeEmail } from "~/lib/refunds";
import { getSecondsWatched } from "~/lib/refunds.server";
import { formatPrice } from "~/lib/utils";
import { parseFormData } from "~/lib/validation";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

const refundActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("approve"),
    refundId: z.coerce.number().int(),
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
  await requireAdmin(request);

  const requests = getOpenRefundRequests().map((refundRequest) => ({
    ...refundRequest,
    // Watched now minus watched as of asking, both measured the way Refund
    // Eligibility measures it. Positions are fractional, so round for display.
    secondsWatchedSince: Math.round(
      getSecondsWatched(refundRequest.learnerId, refundRequest.courseId) -
        getSecondsWatched(refundRequest.learnerId, refundRequest.courseId, {
          asOf: refundRequest.requestedAt,
        })
    ),
  }));

  return { requests };
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
      ? { decision: "approve", resolvedByUserId: userId, resolvedAt }
      : {
          decision: "decline",
          note: parsed.data.note,
          resolvedByUserId: userId,
          resolvedAt,
        }
  );

  if (!resolution.ok) {
    throw data(resolution.error, { status: 409 });
  }

  const { update } = resolution;

  db.transaction((tx) => {
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

    // An approved Refund ends access. The Purchase, progress and watch events
    // stay as history.
    if (update.status === RefundStatus.Approved) {
      tx.delete(enrollments)
        .where(
          and(
            eq(enrollments.userId, refundRequest.learnerId),
            eq(enrollments.courseId, refundRequest.courseId)
          )
        )
        .run();
    }
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
        }
      : { ...learner, outcome: "declined", declineNote: parsed.data.note }
  );

  console.log(
    `[email] to=${email.to} subject=${email.subject}\n${email.body}`
  );

  return { resolved: update.status };
}

type OpenRefundRequest = Route.ComponentProps["loaderData"]["requests"][number];

function RefundRequestRow({ refundRequest }: { refundRequest: OpenRefundRequest }) {
  const fetcher = useFetcher<typeof action>();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    toast.success(
      fetcher.data.resolved === RefundStatus.Approved
        ? "Refund approved. The Learner no longer has access."
        : "Refund Request declined."
    );
  }, [fetcher.state, fetcher.data]);

  const requestedOn = new Date(refundRequest.requestedAt).toLocaleDateString(
    "en-US",
    { year: "numeric", month: "short", day: "numeric" }
  );

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
        {formatWatchTime(refundRequest.secondsWatchedSince)}
      </td>
      <td className="px-4 py-3">
        {declining ? (
          <fetcher.Form method="post" className="flex w-64 flex-col gap-2">
            <input type="hidden" name="intent" value="decline" />
            <input type="hidden" name="refundId" value={refundRequest.id} />
            <Textarea
              name="note"
              required
              placeholder="Why is this declined? The Learner will read this."
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                variant="destructive"
                disabled={busy || note.trim() === ""}
              >
                Decline
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setDeclining(false)}
              >
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        ) : (
          <div className="flex gap-2">
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="approve" />
              <input type="hidden" name="refundId" value={refundRequest.id} />
              <Button type="submit" size="sm" disabled={busy}>
                Approve
              </Button>
            </fetcher.Form>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setDeclining(true)}
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
  "Watched since",
  "",
];

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { requests } = loaderData;

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
