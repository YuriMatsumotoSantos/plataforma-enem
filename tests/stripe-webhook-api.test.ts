import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { user, subscriptions } from "@/db/schema";
import { POST } from "@/app/api/stripe/webhook/route";

const WEBHOOK_SECRET = "whsec_teste_fixo_de_ambiente_local";

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "sk_test_dummy_para_testes";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

async function createTestUser() {
  const [row] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Aluno Teste",
      email: `webhook-${crypto.randomUUID()}@example.com`,
      emailVerified: false,
    })
    .returning();
  return row;
}

function buildSubscriptionEvent(
  type: string,
  overrides: {
    id: string;
    status: string;
    customer: string;
    metadata?: Record<string, string>;
  }
) {
  return {
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    type,
    data: {
      object: {
        id: overrides.id,
        object: "subscription",
        status: overrides.status,
        customer: overrides.customer,
        metadata: overrides.metadata ?? {},
        items: {
          data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 }],
        },
      },
    },
  };
}

function sign(payload: string) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
}

function postWebhook(payload: string, signature: string) {
  return POST(
    new Request("http://localhost:3000/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    })
  );
}

describe("POST /api/stripe/webhook", () => {
  it("retorna 400 com assinatura inválida", async () => {
    const payload = JSON.stringify({ type: "customer.subscription.created" });
    const response = await postWebhook(payload, "assinatura-forjada");
    expect(response.status).toBe(400);
  });

  it("insere a assinatura em customer.subscription.created usando metadata.userId", async () => {
    const testUser = await createTestUser();
    const subscriptionId = `sub_${crypto.randomUUID()}`;
    const payload = JSON.stringify(
      buildSubscriptionEvent("customer.subscription.created", {
        id: subscriptionId,
        status: "active",
        customer: "cus_teste_webhook",
        metadata: { userId: testUser.id },
      })
    );
    const response = await postWebhook(payload, sign(payload));
    expect(response.status).toBe(200);

    const [row] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
    expect(row.userId).toBe(testUser.id);
    expect(row.status).toBe("active");
  });

  it("atualiza a assinatura existente em customer.subscription.updated sem duplicar", async () => {
    const testUser = await createTestUser();
    const subscriptionId = `sub_${crypto.randomUUID()}`;
    const createdPayload = JSON.stringify(
      buildSubscriptionEvent("customer.subscription.created", {
        id: subscriptionId,
        status: "active",
        customer: "cus_teste_webhook",
        metadata: { userId: testUser.id },
      })
    );
    await postWebhook(createdPayload, sign(createdPayload));

    const updatedPayload = JSON.stringify(
      buildSubscriptionEvent("customer.subscription.updated", {
        id: subscriptionId,
        status: "past_due",
        customer: "cus_teste_webhook",
      })
    );
    const response = await postWebhook(updatedPayload, sign(updatedPayload));
    expect(response.status).toBe(200);

    const rows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("past_due");
  });

  it("reassinatura com novo stripeSubscriptionId atualiza a mesma linha do usuário", async () => {
    const testUser = await createTestUser();
    const firstSubscriptionId = `sub_${crypto.randomUUID()}`;
    const createdPayload = JSON.stringify(
      buildSubscriptionEvent("customer.subscription.created", {
        id: firstSubscriptionId,
        status: "active",
        customer: "cus_teste_webhook",
        metadata: { userId: testUser.id },
      })
    );
    await postWebhook(createdPayload, sign(createdPayload));

    const deletedPayload = JSON.stringify(
      buildSubscriptionEvent("customer.subscription.deleted", {
        id: firstSubscriptionId,
        status: "canceled",
        customer: "cus_teste_webhook",
      })
    );
    await postWebhook(deletedPayload, sign(deletedPayload));

    const secondSubscriptionId = `sub_${crypto.randomUUID()}`;
    const resubscribePayload = JSON.stringify(
      buildSubscriptionEvent("customer.subscription.created", {
        id: secondSubscriptionId,
        status: "active",
        customer: "cus_teste_webhook",
        metadata: { userId: testUser.id },
      })
    );
    const response = await postWebhook(resubscribePayload, sign(resubscribePayload));
    expect(response.status).toBe(200);

    const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, testUser.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].stripeSubscriptionId).toBe(secondSubscriptionId);
    expect(rows[0].status).toBe("active");
  });

  it("marca como canceled em customer.subscription.deleted", async () => {
    const testUser = await createTestUser();
    const subscriptionId = `sub_${crypto.randomUUID()}`;
    const createdPayload = JSON.stringify(
      buildSubscriptionEvent("customer.subscription.created", {
        id: subscriptionId,
        status: "active",
        customer: "cus_teste_webhook",
        metadata: { userId: testUser.id },
      })
    );
    await postWebhook(createdPayload, sign(createdPayload));

    const deletedPayload = JSON.stringify(
      buildSubscriptionEvent("customer.subscription.deleted", {
        id: subscriptionId,
        status: "canceled",
        customer: "cus_teste_webhook",
      })
    );
    const response = await postWebhook(deletedPayload, sign(deletedPayload));
    expect(response.status).toBe(200);

    const [row] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
    expect(row.status).toBe("canceled");
  });
});
