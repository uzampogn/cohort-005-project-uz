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
  staffNote: string | null;
};

export type RefundResolution =
  | { ok: true; update: RefundResolutionUpdate }
  | { ok: false; error: string };

export function resolveRefundRequest(
  request: RefundRequestToResolve,
  decision: RefundDecision
): RefundResolution {
  if (request.status !== RefundStatus.Requested) {
    return { ok: false, error: "This Refund Request has already been resolved." };
  }

  if (request.learnerId === decision.resolvedByUserId) {
    return { ok: false, error: "You cannot decide your own Refund Request." };
  }

  if (decision.decision === "decline") {
    if (decision.note.trim() === "") {
      return { ok: false, error: "A decline needs a note the Learner can read." };
    }
    return {
      ok: true,
      update: {
        status: RefundStatus.Declined,
        amountRefunded: null,
        resolvedAt: decision.resolvedAt,
        resolvedByUserId: decision.resolvedByUserId,
        declineNote: decision.note,
        staffNote: null,
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
      staffNote: decision.note?.trim() || null,
    },
  };
}
