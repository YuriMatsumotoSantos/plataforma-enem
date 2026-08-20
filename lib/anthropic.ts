import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

// Inicialização preguiçosa, mesmo padrão de lib/gemini.ts: evita que importar
// este arquivo quebre em ambientes sem ANTHROPIC_API_KEY (ex: CI, testes que
// mockam este módulo e nunca chegam a construir um client de verdade).
export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY não definida (verifique .env.local)");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export const ANTHROPIC_MODEL = "claude-sonnet-5";
