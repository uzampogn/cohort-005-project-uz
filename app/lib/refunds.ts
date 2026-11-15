import { formatPrice } from "~/lib/utils";

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_MAX_HOURS_WATCHED = 2;
export const REFUND_MAX_SHARE_COMPLETED = 0.5;

/** What Refund Eligibility is judged on, gathered at the moment the Learner asks. */
export type RefundEligibilityFacts = {
  today: Date;
  purchasedAt: Date;
  amountPaid: number;
  secondsWatched: number;
  lessonsCompleted: number;
  totalLessons: number;
  /** The Purchase has Team Seats attached, claimed or not. */
  isTeamLicence: boolean;
  hasClaimedSeat: boolean;
  /** Any Refund Request on this Purchase, whatever its status. */
  hasAnyRefundRequestOnPurchase: boolean;
  /** An approved Refund on an earlier Purchase of this Course. */
  previouslyRefundedForCourse: boolean;
};

export type RefundEligibility =
  | { eligible: true; amount: number; lastDayInWindow: string }
  | { eligible: false; reason: string };

// The window is counted in whole days, not hours: a Learner who buys at 23:00
// still gets the whole of their fourteenth day.
function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

function lastDayOfWindow(purchasedAt: Date): string {
  const deadline = new Date(purchasedAt);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  return calendarDay(deadline);
}

export const REFUND_ALREADY_RAISED_REASON =
  "A Refund Request has already been raised on this Purchase.";

export function checkRefundEligibility(
  facts: RefundEligibilityFacts
): RefundEligibility {
  if (facts.hasClaimedSeat) {
    return {
      eligible: false,
      reason: "A claimed Team Seat belongs to the team and cannot be refunded.",
    };
  }

  if (facts.isTeamLicence) {
    return { eligible: false, reason: "Team licences cannot be refunded." };
  }

  if (facts.hasAnyRefundRequestOnPurchase) {
    return {
      eligible: false,
      reason: REFUND_ALREADY_RAISED_REASON,
    };
  }

  if (facts.previouslyRefundedForCourse) {
    return {
      eligible: false,
      reason: "You have already been refunded for this Course once.",
    };
  }

  const lastDayInWindow = lastDayOfWindow(facts.purchasedAt);

  if (calendarDay(facts.today) > lastDayInWindow) {
    return {
      eligible: false,
      reason: `The ${REFUND_WINDOW_DAYS}-day refund window closed on ${lastDayInWindow}.`,
    };
  }

  if (facts.secondsWatched >= REFUND_MAX_HOURS_WATCHED * 60 * 60) {
    return {
      eligible: false,
      reason: `You have watched ${REFUND_MAX_HOURS_WATCHED} hours or more of this Course.`,
    };
  }

  if (
    facts.totalLessons > 0 &&
    facts.lessonsCompleted / facts.totalLessons >= REFUND_MAX_SHARE_COMPLETED
  ) {
    return {
      eligible: false,
      reason: "You have completed half or more of the lessons in this Course.",
    };
  }

  return { eligible: true, amount: facts.amountPaid, lastDayInWindow };
}

/**
 * The confirmation a Learner gets in their inbox when they raise a Refund
 * Request. There is no mail transport wired up yet, so callers send the built
 * message to the server log.
 */
export function buildRefundRequestEmail(input: {
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  amount: number;
}) {
  return {
    to: input.learnerEmail,
    subject: `Refund Request received — ${input.courseTitle}`,
    body: [
      `Hi ${input.learnerName},`,
      "",
      `We have your Refund Request for "${input.courseTitle}".`,
      `If it is approved, your Refund will be ${formatPrice(input.amount)}, the amount you paid.`,
      "",
      "Our team reviews every Refund Request by hand. You do not need to do anything else — we will email you again when it is done.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export type RefundOutcome =
  | { outcome: "approved"; amountRefunded: number }
  | { outcome: "declined"; declineNote: string };

/**
 * The email a Learner gets once an Admin approves or declines their Refund
 * Request. Like the request email, callers send it to the server log.
 */
export function buildRefundOutcomeEmail(
  input: {
    learnerName: string;
    learnerEmail: string;
    courseTitle: string;
  } & RefundOutcome
) {
  const greeting = [`Hi ${input.learnerName},`, ""];
  const signOff = ["", "— The Cadence team"];

  if (input.outcome === "declined") {
    return {
      to: input.learnerEmail,
      subject: `Refund Request declined — ${input.courseTitle}`,
      body: [
        ...greeting,
        `Your Refund Request for "${input.courseTitle}" has been declined.`,
        "Our team left this note for you:",
        "",
        input.declineNote,
        "",
        "You keep your access to the Course. This decision is final.",
        ...signOff,
      ].join("\n"),
    };
  }

  return {
    to: input.learnerEmail,
    subject: `Refund approved — ${input.courseTitle}`,
    body: [
      ...greeting,
      `Your Refund Request for "${input.courseTitle}" has been approved.`,
      `Your Refund of ${formatPrice(input.amountRefunded)} is on its way to you.`,
      "Your access to the Course has ended; your progress is kept.",
      ...signOff,
    ].join("\n"),
  };
}
