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
      reason: "A Refund Request has already been raised on this Purchase.",
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
