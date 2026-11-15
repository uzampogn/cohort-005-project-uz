import { and, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  videoWatchEvents,
  LessonProgressStatus,
  RefundStatus,
} from "~/db/schema";
import { checkRefundEligibility, type RefundEligibility } from "~/lib/refunds";

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`, sql`${purchases.id} desc`)
    .get();
}

function getLessonIdsForCourse(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function countCompletedLessons(userId: number, lessonIds: number[]): number {
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return result?.count ?? 0;
}

/**
 * Seconds of a Course the Learner has watched: the furthest point reached in
 * each lesson, added up across the Course. With `asOf`, only watch events
 * recorded at or before that moment count, so the same measure can be taken
 * as it stood then.
 */
export function getSecondsWatched(
  userId: number,
  courseId: number,
  options: { asOf?: string } = {}
): number {
  return db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .innerJoin(lessons, eq(videoWatchEvents.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        eq(modules.courseId, courseId),
        options.asOf === undefined
          ? undefined
          : lte(videoWatchEvents.createdAt, options.asOf)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all()
    .reduce((total, row) => total + row.furthest, 0);
}

// A Purchase with Team Seats attached, claimed or not, is a team licence.
function isTeamLicence(purchaseId: number): boolean {
  return Boolean(
    db
      .select({ id: coupons.id })
      .from(coupons)
      .where(eq(coupons.purchaseId, purchaseId))
      .get()
  );
}

function hasClaimedSeat(purchaseId: number): boolean {
  return Boolean(
    db
      .select({ id: coupons.id })
      .from(coupons)
      .where(
        and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt))
      )
      .get()
  );
}

function hasAnyRefundRequest(purchaseId: number): boolean {
  return Boolean(
    db
      .select({ id: refunds.id })
      .from(refunds)
      .where(eq(refunds.purchaseId, purchaseId))
      .get()
  );
}

function wasRefundedOnEarlierPurchase(
  userId: number,
  courseId: number,
  currentPurchaseId: number
): boolean {
  return Boolean(
    db
      .select({ id: refunds.id })
      .from(refunds)
      .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
      .where(
        and(
          eq(purchases.userId, userId),
          eq(purchases.courseId, courseId),
          ne(purchases.id, currentPurchaseId),
          eq(refunds.status, RefundStatus.Approved)
        )
      )
      .get()
  );
}

/** The Refund Request on a Purchase that an Admin has not resolved yet. */
export function getOpenRefundRequest(purchaseId: number) {
  return (
    db
      .select({ id: refunds.id, requestedAt: refunds.requestedAt })
      .from(refunds)
      .where(
        and(
          eq(refunds.purchaseId, purchaseId),
          eq(refunds.status, RefundStatus.Requested)
        )
      )
      .get() ?? null
  );
}

/**
 * Refund Eligibility for the Learner's latest Purchase of a Course, judged
 * now. Returns null when the Learner has no Purchase of the Course.
 */
export function getRefundEligibility(
  userId: number,
  courseId: number
): {
  purchase: typeof purchases.$inferSelect;
  eligibility: RefundEligibility;
} | null {
  const purchase = getLatestPurchase(userId, courseId);
  if (!purchase) return null;

  const lessonIds = getLessonIdsForCourse(courseId);

  const eligibility = checkRefundEligibility({
    today: new Date(),
    purchasedAt: new Date(purchase.createdAt),
    amountPaid: purchase.amountPaid,
    secondsWatched: getSecondsWatched(userId, courseId),
    lessonsCompleted: countCompletedLessons(userId, lessonIds),
    totalLessons: lessonIds.length,
    isTeamLicence: isTeamLicence(purchase.id),
    hasClaimedSeat: hasClaimedSeat(purchase.id),
    hasAnyRefundRequestOnPurchase: hasAnyRefundRequest(purchase.id),
    previouslyRefundedForCourse: wasRefundedOnEarlierPurchase(
      userId,
      courseId,
      purchase.id
    ),
  });

  return { purchase, eligibility };
}
