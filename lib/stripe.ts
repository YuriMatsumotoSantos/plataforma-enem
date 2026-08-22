import Stripe from "stripe";

let client: Stripe | undefined;

// Inicialização preguiçosa, mesmo padrão de lib/gemini.ts e lib/anthropic.ts:
// construir o cliente (e validar a chave) só na primeira chamada real, não no
// carregamento do módulo — evita que importar este arquivo quebre em
// ambientes sem STRIPE_SECRET_KEY, como o CI.
export function getStripeClient(): Stripe {
  if (!client) {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error("STRIPE_SECRET_KEY não definida (verifique .env.local)");
    }
    client = new Stripe(apiKey);
  }
  return client;
}
