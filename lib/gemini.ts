import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | undefined;

// Inicialização preguiçosa: construir o cliente (e validar a API key) só na
// primeira chamada real, não no carregamento do módulo. Isso evita que
// simplesmente importar este arquivo (ex: testes que só exercitam funções
// puras de um módulo vizinho) quebre em ambientes sem GEMINI_API_KEY, como o CI.
export function getGeminiClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY não definida (verifique .env.local)");
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

// Flash Lite (não o Flash "cheio") por causa da cota diária real desta conta:
// gemini-2.5-flash tem só 20 requisições/dia, insuficiente para iterar durante
// o desenvolvimento (qualquer re-execução ao depurar já estoura o limite).
// gemini-3.5-flash-lite tem 500/dia — folga confortável tanto para testar
// quanto para a ingestão real (que usa só ~4-6 chamadas no total).
export const GEMINI_MODEL = "gemini-3.5-flash-lite";
