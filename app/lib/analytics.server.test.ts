import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "~/db/schema";
import {
  CourseStatus,
  RefundStatus,
  UserRole,
  categories,
  courses,
  purchases,
  refunds,
  users,
} from "~/db/schema";
import { notRefunded } from "./analytics.server";

// A real database built from the project's own migrations, so the rule is
// checked against the same tables and columns the analytics page queries.
function freshDb() {
  const db = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: "drizzle" });
  return db;
}

describe("notRefunded", () => {
  it("counts every Purchase toward revenue except one with an approved Refund", () => {
    const db = freshDb();

    const [learner] = db
      .insert(users)
      .values({
        name: "Learner",
        email: "learner@example.com",
        role: UserRole.Student,
      })
      .returning()
      .all();
    const [category] = db
      .insert(categories)
      .values({ name: "Code", slug: "code" })
      .returning()
      .all();
    const [course] = db
      .insert(courses)
      .values({
        title: "Course",
        slug: "course",
        description: "A course",
        salesCopy: "Buy it",
        instructorId: learner.id,
        categoryId: category.id,
        status: CourseStatus.Published,
        price: 5000,
      })
      .returning()
      .all();

    const buy = (amountPaid: number) => {
      const [purchase] = db
        .insert(purchases)
        .values({ userId: learner.id, courseId: course.id, amountPaid })
        .returning()
        .all();
      return purchase.id;
    };
    const noRequest = buy(1000);
    const openRequest = buy(2000);
    const declined = buy(3000);
    const refunded = buy(4000);

    db.insert(refunds)
      .values([
        {
          purchaseId: openRequest,
          status: RefundStatus.Requested,
          reason: "Not for me",
        },
        {
          purchaseId: declined,
          status: RefundStatus.Declined,
          reason: "Not for me",
          declineNote: "Outside the window",
        },
        {
          purchaseId: refunded,
          status: RefundStatus.Approved,
          reason: "Not for me",
          amountRefunded: 4000,
        },
      ])
      .run();

    const counted = db
      .select({ id: purchases.id })
      .from(purchases)
      .where(notRefunded())
      .orderBy(purchases.id)
      .all()
      .map((row) => row.id);

    expect(counted).toEqual([noRequest, openRequest, declined]);
  });
});
