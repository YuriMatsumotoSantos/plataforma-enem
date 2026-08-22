import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/stripe", () => ({
  getStripeClient: vi.fn(),
}));

import { getStripeClient } from "@/lib/stripe";
import { POST } from "@/app/api/stripe/checkout/route";

async function createUserCookie() {
  const email = `checkout-${crypto.randomUUID()}@example.com`;
  await auth.api.signUpEmail({ body: { email, password: "senha-segura-123", name: "Aluno" } });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return signIn.headers.get("set-cookie") ?? "";
}

beforeEach(() => {
  process.env.STRIPE_PRICE_ID_PREMIUM = "price_test_123";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
});

describe("POST /api/stripe/checkout", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/stripe/checkout", { method: "POST" });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("cria uma sessão de checkout e retorna a url", async () => {
    const cookie = await createUserCookie();
    vi.mocked(getStripeClient).mockReturnValue({
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({ url: "https://checkout.stripe.com/test-session" }),
        },
      },
    } as never);

    const request = new Request("http://localhost:3000/api/stripe/checkout", {
      method: "POST",
      headers: { cookie },
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://checkout.stripe.com/test-session");
  });

  it("retorna 502 quando a Stripe não devolve uma url", async () => {
    const cookie = await createUserCookie();
    vi.mocked(getStripeClient).mockReturnValue({
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({ url: null }),
        },
      },
    } as never);

    const request = new Request("http://localhost:3000/api/stripe/checkout", {
      method: "POST",
      headers: { cookie },
    });
    const response = await POST(request);
    expect(response.status).toBe(502);
  });
});
