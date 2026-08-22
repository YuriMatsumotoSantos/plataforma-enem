import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user, subscriptions } from "@/db/schema";

async function createTestUser() {
  const [row] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Aluno Teste",
      email: `subscriptions-schema-${crypto.randomUUID()}@example.com`,
      emailVerified: false,
    })
    .returning();
  return row;
}

describe("schema: subscriptions", () => {
  it("insere uma assinatura e lê de volta", async () => {
    const testUser = await createTestUser();
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const [sub] = await db
      .insert(subscriptions)
      .values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        stripeCustomerId: `cus_${crypto.randomUUID()}`,
        stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
        status: "active",
        currentPeriodEnd: periodEnd,
      })
      .returning();

    const [found] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
    expect(found.status).toBe("active");
    expect(found.currentPeriodEnd.getTime()).toBe(periodEnd.getTime());
  });

  it("rejeita uma segunda assinatura para o mesmo usuário (userId é unique)", async () => {
    const testUser = await createTestUser();
    await db.insert(subscriptions).values({
      id: crypto.randomUUID(),
      userId: testUser.id,
      stripeCustomerId: `cus_${crypto.randomUUID()}`,
      stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
      status: "active",
      currentPeriodEnd: new Date(),
    });

    await expect(
      db.insert(subscriptions).values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        stripeCustomerId: `cus_${crypto.randomUUID()}`,
        stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
        status: "active",
        currentPeriodEnd: new Date(),
      })
    ).rejects.toThrow();
  });

  it("apaga a assinatura em cascata quando o usuário é apagado", async () => {
    const testUser = await createTestUser();
    const [sub] = await db
      .insert(subscriptions)
      .values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        stripeCustomerId: `cus_${crypto.randomUUID()}`,
        stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
        status: "active",
        currentPeriodEnd: new Date(),
      })
      .returning();

    await db.delete(user).where(eq(user.id, testUser.id));

    const remaining = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
    expect(remaining).toHaveLength(0);
  });
});
