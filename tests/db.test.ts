import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

describe("db", () => {
  it("connects to Postgres and runs a query", async () => {
    const result = await db.execute(sql`select 1 as value`);
    expect(result[0].value).toBe(1);
  });
});
