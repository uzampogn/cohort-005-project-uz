import { describe, it, expect } from "vitest";
import {
  buildRefundOutcomeEmail,
  buildRefundRequestEmail,
  checkRefundEligibility,
  type RefundEligibilityFacts,
} from "./refunds";

// Dates are built from local parts, because the fourteen-day window is
// counted in the server's calendar days.
const purchasedAt = new Date(2026, 0, 1, 23, 0);

// A fresh individual Purchase that passes every rule. Each test changes the
// one fact it is about.
function facts(overrides: Partial<RefundEligibilityFacts> = {}) {
  return {
    today: new Date(2026, 0, 3, 12, 0),
    purchasedAt,
    amountPaid: 7900,
    secondsWatched: 0,
    lessonsCompleted: 0,
    totalLessons: 10,
    isTeamLicence: false,
    hasClaimedSeat: false,
    hasAnyRefundRequestOnPurchase: false,
    previouslyRefundedForCourse: false,
    ...overrides,
  };
}

describe("checkRefundEligibility", () => {
  it("lets a Learner raise a Refund Request for exactly what they paid", () => {
    expect(checkRefundEligibility(facts({ amountPaid: 3950 }))).toEqual({
      eligible: true,
      amount: 3950,
      lastDayInWindow: "2026-01-15",
    });
  });

  describe("the fourteen-day window", () => {
    it("gives a 23:00 Purchase the whole of its fourteenth day", () => {
      const result = checkRefundEligibility(
        facts({ today: new Date(2026, 0, 15, 23, 59) })
      );
      expect(result.eligible).toBe(true);
    });

    it("closes at midnight after the fourteenth day", () => {
      expect(
        checkRefundEligibility(facts({ today: new Date(2026, 0, 16, 0, 0) }))
      ).toEqual({
        eligible: false,
        reason: "The 14-day refund window closed on 2026-01-15.",
      });
    });
  });

  describe("how much has been watched", () => {
    it("allows a Learner who has watched just under two hours", () => {
      const result = checkRefundEligibility(facts({ secondsWatched: 7199 }));
      expect(result.eligible).toBe(true);
    });

    it("refuses a Learner who has watched two hours", () => {
      expect(checkRefundEligibility(facts({ secondsWatched: 7200 }))).toEqual({
        eligible: false,
        reason: "You have watched 2 hours or more of this Course.",
      });
    });
  });

  describe("how many lessons are completed", () => {
    it("allows a Learner who has completed under half the lessons", () => {
      const result = checkRefundEligibility(
        facts({ lessonsCompleted: 4, totalLessons: 9 })
      );
      expect(result.eligible).toBe(true);
    });

    it("refuses a Learner who has completed half the lessons", () => {
      expect(
        checkRefundEligibility(facts({ lessonsCompleted: 5, totalLessons: 10 }))
      ).toEqual({
        eligible: false,
        reason: "You have completed half or more of the lessons in this Course.",
      });
    });

    it("allows a Course with no lessons yet", () => {
      const result = checkRefundEligibility(
        facts({ lessonsCompleted: 0, totalLessons: 0 })
      );
      expect(result.eligible).toBe(true);
    });
  });

  describe("team licences", () => {
    it("refuses a team licence even when no Team Seat is claimed", () => {
      expect(checkRefundEligibility(facts({ isTeamLicence: true }))).toEqual({
        eligible: false,
        reason: "Team licences cannot be refunded.",
      });
    });

    it("refuses a team licence with a claimed Team Seat", () => {
      expect(
        checkRefundEligibility(
          facts({ isTeamLicence: true, hasClaimedSeat: true })
        )
      ).toEqual({
        eligible: false,
        reason: "A claimed Team Seat belongs to the team and cannot be refunded.",
      });
    });
  });

  describe("earlier Refund Requests", () => {
    // The caller sets this for a Refund Request of any status, so an open
    // one and a declined one look the same here: a decline is final.
    it("refuses a second Refund Request on the same Purchase", () => {
      expect(
        checkRefundEligibility(facts({ hasAnyRefundRequestOnPurchase: true }))
      ).toEqual({
        eligible: false,
        reason: "A Refund Request has already been raised on this Purchase.",
      });
    });

    it("refuses a re-purchase after the Learner was refunded for this Course", () => {
      expect(
        checkRefundEligibility(facts({ previouslyRefundedForCourse: true }))
      ).toEqual({
        eligible: false,
        reason: "You have already been refunded for this Course once.",
      });
    });
  });
});

describe("buildRefundRequestEmail", () => {
  const email = buildRefundRequestEmail({
    learnerName: "Liam",
    learnerEmail: "liam@example.com",
    courseTitle: "Introduction to TypeScript",
    amount: 3950,
  });

  it("goes to the Learner", () => {
    expect(email.to).toBe("liam@example.com");
  });

  it("names a Refund Request in the subject", () => {
    expect(email.subject).toBe(
      "Refund Request received — Introduction to TypeScript"
    );
  });

  it("confirms the Refund Request for what the Learner paid", () => {
    expect(email.body).toBe(
      [
        "Hi Liam,",
        "",
        'We have your Refund Request for "Introduction to TypeScript".',
        "If it is approved, your Refund will be $39.50, the amount you paid.",
        "",
        "Our team reviews every Refund Request by hand. You do not need to do anything else — we will email you again when it is done.",
        "",
        "— The Cadence team",
      ].join("\n")
    );
  });

  it("never calls it a Reversal or a Chargeback", () => {
    expect(`${email.subject}\n${email.body}`).not.toMatch(
      /reversal|chargeback/i
    );
  });
});

describe("buildRefundOutcomeEmail", () => {
  const learner = {
    learnerName: "Liam",
    learnerEmail: "liam@example.com",
    courseTitle: "Introduction to TypeScript",
  };

  describe("an approved Refund", () => {
    const email = buildRefundOutcomeEmail({
      ...learner,
      outcome: "approved",
      amountRefunded: 3950,
    });

    it("tells the Learner it was approved and how much comes back", () => {
      expect(email).toEqual({
        to: "liam@example.com",
        subject: "Refund approved — Introduction to TypeScript",
        body: [
          "Hi Liam,",
          "",
          'Your Refund Request for "Introduction to TypeScript" has been approved.',
          "Your Refund of $39.50 is on its way to you.",
          "Your access to the Course has ended; your progress is kept.",
          "",
          "— The Cadence team",
        ].join("\n"),
      });
    });
  });

  describe("a declined Refund Request", () => {
    const email = buildRefundOutcomeEmail({
      ...learner,
      outcome: "declined",
      declineNote: "You have watched most of the Course since asking.",
    });

    it("tells the Learner it was declined and passes on the Admin's note", () => {
      expect(email).toEqual({
        to: "liam@example.com",
        subject: "Refund Request declined — Introduction to TypeScript",
        body: [
          "Hi Liam,",
          "",
          'Your Refund Request for "Introduction to TypeScript" has been declined.',
          "Our team left this note for you:",
          "",
          "You have watched most of the Course since asking.",
          "",
          "You keep your access to the Course. This decision is final.",
          "",
          "— The Cadence team",
        ].join("\n"),
      });
    });
  });

  it("never calls it a Reversal or a Chargeback, whatever the outcome", () => {
    const emails = [
      buildRefundOutcomeEmail({
        ...learner,
        outcome: "approved",
        amountRefunded: 3950,
      }),
      buildRefundOutcomeEmail({
        ...learner,
        outcome: "declined",
        declineNote: "Outside the policy.",
      }),
    ];
    for (const email of emails) {
      expect(`${email.subject}\n${email.body}`).not.toMatch(
        /reversal|chargeback/i
      );
    }
  });
});
