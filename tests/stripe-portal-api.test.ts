import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { subscriptions } from "@/db/schema";

vi.mock("@/lib/stripe", () => ({
  getStripeClient: vi.fn(),
}));

import { getStripeClient } from "@/lib/stripe";
import { POST } from "@/app/api/stripe/portal/route";

async function createUserAndCookie() {
  const email = `portal-${crypto.randomUUID()}@example.com`;
  const signUp = await auth.api.signUpEmail({
    body: { email, password: "senha-segura-123", name: "Aluno" },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return { userId: signUp.user.id, cookie: signIn.headers.get("set-cookie") ?? "" };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
});

describe("POST /api/stripe/portal", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/stripe/portal", { method: "POST" });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("retorna 400 quando o usuário nunca assinou", async () => {
    const { cookie } = await createUserAndCookie();
    const request = new Request("http://localhost:3000/api/stripe/portal", {
      method: "POST",
      headers: { cookie },
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("retorna 502 quando getStripeClient lança (ex: chave ausente)", async () => {
    const { userId, cookie } = await createUserAndCookie();
    await db.insert(subscriptions).values({
      id: crypto.randomUUID(),
      userId,
      stripeCustomerId: "cus_teste_portal_falha",
      stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    vi.mocked(getStripeClient).mockImplementation(() => {
      throw new Error("STRIPE_SECRET_KEY não definida");
    });

    const request = new Request("http://localhost:3000/api/stripe/portal", {
      method: "POST",
      headers: { cookie },
    });
    const response = await POST(request);
    expect(response.status).toBe(502);
  });

  it("cria uma sessão de portal e retorna a url quando já existe assinatura", async () => {
    const { userId, cookie } = await createUserAndCookie();
    await db.insert(subscriptions).values({
      id: crypto.randomUUID(),
      userId,
      stripeCustomerId: "cus_teste_portal",
      stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    vi.mocked(getStripeClient).mockReturnValue({
      billingPortal: {
        sessions: {
          create: vi.fn().mockResolvedValue({ url: "https://billing.stripe.com/test-portal" }),
        },
      },
    } as never);

    const request = new Request("http://localhost:3000/api/stripe/portal", {
      method: "POST",
      headers: { cookie },
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://billing.stripe.com/test-portal");
  });
});
