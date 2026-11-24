import { describe, it, expect } from "vitest";
import { RefundStatus } from "~/db/schema";
import { resolveRefundRequest } from "./refund-resolution";

const ADMIN_ID = 7;
const LEARNER_ID = 42;
const NOW = "2026-11-15T10:00:00.000Z";

const openRequest = {
  status: RefundStatus.Requested,
  amountPaid: 7900,
  learnerId: LEARNER_ID,
};

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
        internalNote: null,
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
        internalNote: null,
      },
    });
  });

  it("approving with an internal note keeps it apart from anything the Learner reads", () => {
    const result = resolveRefundRequest(openRequest, {
      decision: "approve",
      note: "Duplicate purchase — bought twice by mistake.",
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
        internalNote: "Duplicate purchase — bought twice by mistake.",
      },
    });
  });

  it("an internal note that is only whitespace is not kept", () => {
    const result = resolveRefundRequest(openRequest, {
      decision: "approve",
      note: "   ",
      resolvedByUserId: ADMIN_ID,
      resolvedAt: NOW,
    });

    expect(result.ok && result.update.internalNote).toBe(null);
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
      kind: "missing-decline-note",
      error: "A decline needs a note the Learner can read.",
    });
  });

  it("a declined Refund Request is final and cannot be approved", () => {
    const result = resolveRefundRequest(
      { ...openRequest, status: RefundStatus.Declined },
      { decision: "approve", resolvedByUserId: ADMIN_ID, resolvedAt: NOW }
    );

    expect(result).toEqual({
      ok: false,
      kind: "already-resolved",
      error: "This Refund Request has already been resolved.",
    });
  });

  it("an approved Refund Request cannot be resolved again", () => {
    const result = resolveRefundRequest(
      { ...openRequest, status: RefundStatus.Approved },
      {
        decision: "decline",
        note: "Changed my mind.",
        resolvedByUserId: ADMIN_ID,
        resolvedAt: NOW,
      }
    );

    expect(result).toEqual({
      ok: false,
      kind: "already-resolved",
      error: "This Refund Request has already been resolved.",
    });
  });

  describe("an Admin who is also the Learner", () => {
    const ownRequest = { ...openRequest, learnerId: ADMIN_ID };

    it("cannot approve their own Refund Request", () => {
      const result = resolveRefundRequest(ownRequest, {
        decision: "approve",
        resolvedByUserId: ADMIN_ID,
        resolvedAt: NOW,
      });

      expect(result).toEqual({
        ok: false,
        kind: "own-refund-request",
        error: "You cannot decide your own Refund Request.",
      });
    });

    it("cannot decline their own Refund Request", () => {
      const result = resolveRefundRequest(ownRequest, {
        decision: "decline",
        note: "Not eligible.",
        resolvedByUserId: ADMIN_ID,
        resolvedAt: NOW,
      });

      expect(result).toEqual({
        ok: false,
        kind: "own-refund-request",
        error: "You cannot decide your own Refund Request.",
      });
    });
  });
});
