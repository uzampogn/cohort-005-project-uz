import { RefundStatus } from "~/db/schema";

export type RefundRequestToResolve = {
  status: RefundStatus;
  /** What the Purchase cost the Learner, in cents. */
  amountPaid: number;
  /** The Learner who raised the Refund Request. */
  learnerId: number;
};

type Resolver = {
  resolvedByUserId: number;
  resolvedAt: string;
};

export type RefundDecision =
  | ({ decision: "approve"; note?: string } & Resolver)
  | ({ decision: "decline"; note: string } & Resolver);

export type RefundResolutionUpdate = {
  status: RefundStatus;
  amountRefunded: number | null;
  resolvedAt: string;
  resolvedByUserId: number;
  declineNote: string | null;
  /** The Admin's internal note on an approval. Never shown to the Learner. */
  internalNote: string | null;
};

export type RefundResolution =
  | { ok: true; update: RefundResolutionUpdate }
  | { ok: false; kind: RefundRefusal; error: string };

/** Why a decision on a Refund Request was refused. */
export type RefundRefusal =
  | "already-resolved"
  | "own-refund-request"
  | "missing-decline-note";

/** An Admin may not decide a Refund Request on their own Purchase. */
export function isOwnRefundRequest(
  request: Pick<RefundRequestToResolve, "learnerId">,
  adminId: number
): boolean {
  return request.learnerId === adminId;
}

export function resolveRefundRequest(
  request: RefundRequestToResolve,
  decision: RefundDecision
): RefundResolution {
  if (request.status !== RefundStatus.Requested) {
    return {
      ok: false,
      kind: "already-resolved",
      error: "This Refund Request has already been resolved.",
    };
  }

  if (isOwnRefundRequest(request, decision.resolvedByUserId)) {
    return {
      ok: false,
      kind: "own-refund-request",
      error: "You cannot decide your own Refund Request.",
    };
  }

  if (decision.decision === "decline") {
    if (decision.note.trim() === "") {
      return {
        ok: false,
        kind: "missing-decline-note",
        error: "A decline needs a note the Learner can read.",
      };
    }
    return {
      ok: true,
      update: {
        status: RefundStatus.Declined,
        amountRefunded: null,
        resolvedAt: decision.resolvedAt,
        resolvedByUserId: decision.resolvedByUserId,
        declineNote: decision.note,
        internalNote: null,
      },
    };
  }

  return {
    ok: true,
    update: {
      status: RefundStatus.Approved,
      amountRefunded: request.amountPaid,
      resolvedAt: decision.resolvedAt,
      resolvedByUserId: decision.resolvedByUserId,
      declineNote: null,
      internalNote: decision.note?.trim() || null,
    },
  };
}
