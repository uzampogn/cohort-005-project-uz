import { describe, it, expect } from "vitest";
import { RefundStatus } from "~/db/schema";
import { resolveRefundRequest } from "./refund-resolution";

const ADMIN_ID = 7;
const NOW = "2026-11-15T10:00:00.000Z";

const openRequest = { status: RefundStatus.Requested, amountPaid: 7900 };

describe("resolveRefundRequest", () => {
  it("approving an open Refund Request refunds exactly what the Purchase cost", () => {
    const result = resolveRefundRequest(openRequest, {
      decision: "approve",
      resolvedByUserId: ADMIN_ID,
      resolvedAt: NOW,
    });

    expect(result).toEqual({
      ok: true,
      update: {
        status: RefundStatus.Approved,
        amountRefunded: 7900,
        resolvedAt: NOW,
        resolvedByUserId: ADMIN_ID,
        declineNote: null,
      },
    });
  });

  it("declining an open Refund Request refunds nothing and keeps the note", () => {
    const result = resolveRefundRequest(openRequest, {
      decision: "decline",
      note: "You completed most of the course before asking.",
      resolvedByUserId: ADMIN_ID,
      resolvedAt: NOW,
    });

    expect(result).toEqual({
      ok: true,
      update: {
        status: RefundStatus.Declined,
        amountRefunded: null,
        resolvedAt: NOW,
        resolvedByUserId: ADMIN_ID,
        declineNote: "You completed most of the course before asking.",
      },
    });
  });

  it("a decline without a note is refused", () => {
    const result = resolveRefundRequest(openRequest, {
      decision: "decline",
      note: "   \n ",
      resolvedByUserId: ADMIN_ID,
      resolvedAt: NOW,
    });

    expect(result).toEqual({
      ok: false,
      error: "A decline needs a note the Learner can read.",
    });
  });

  it("a declined Refund Request is final and cannot be approved", () => {
    const result = resolveRefundRequest(
      { status: RefundStatus.Declined, amountPaid: 7900 },
      { decision: "approve", resolvedByUserId: ADMIN_ID, resolvedAt: NOW }
    );

    expect(result).toEqual({
      ok: false,
      error: "This Refund Request has already been resolved.",
    });
  });

  it("an approved Refund Request cannot be resolved again", () => {
    const result = resolveRefundRequest(
      { status: RefundStatus.Approved, amountPaid: 7900 },
      {
        decision: "decline",
        note: "Changed my mind.",
        resolvedByUserId: ADMIN_ID,
        resolvedAt: NOW,
      }
    );

    expect(result).toEqual({
      ok: false,
      error: "This Refund Request has already been resolved.",
    });
  });
});
