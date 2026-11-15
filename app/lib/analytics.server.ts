import { and, eq, notExists, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/sqlite-core";
import { RefundStatus, purchases, refunds } from "~/db/schema";

/**
 * The Purchase has no approved Refund, so it counts toward revenue and sales.
 *
 * Only an approved Refund takes a Purchase out: the money went back to the
 * Learner. An open Refund Request still counts (the Learner keeps access until
 * an Admin decides), and so does a declined one.
 *
 * Built with a standalone query builder rather than the app's `db`, so it
 * references tables only and works inside a query on any drizzle instance.
 * Every revenue and sales query applies this, so a refunded Purchase leaves
 * every figure at once.
 */
export function notRefunded() {
  return notExists(
    new QueryBuilder()
      .select({ one: sql`1` })
      .from(refunds)
      .where(
        and(
          eq(refunds.purchaseId, purchases.id),
          eq(refunds.status, RefundStatus.Approved)
        )
      )
  );
}
