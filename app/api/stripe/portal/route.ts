import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getStripeClient } from "@/lib/stripe";
import { db } from "@/lib/db";
import { subscriptions } from "@/db/schema";
import { env } from "@/lib/env";

export async function POST(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const [existing] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, session.user.id));

  if (!existing) {
    return Response.json({ error: "Você ainda não tem uma assinatura" }, { status: 400 });
  }

  const stripe = getStripeClient();
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: existing.stripeCustomerId,
    return_url: `${env.NEXT_PUBLIC_APP_URL}/planos`,
  });

  return Response.json({ url: portalSession.url });
}
