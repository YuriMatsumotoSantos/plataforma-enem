import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY não definida (verifique .env.local)");
}

export const gemini = new GoogleGenAI({ apiKey });
// Flash Lite (não o Flash "cheio") por causa da cota diária real desta conta:
// gemini-2.5-flash tem só 20 requisições/dia, insuficiente para iterar durante
// o desenvolvimento (qualquer re-execução ao depurar já estoura o limite).
// gemini-3.5-flash-lite tem 500/dia — folga confortável tanto para testar
// quanto para a ingestão real (que usa só ~4-6 chamadas no total).
export const GEMINI_MODEL = "gemini-3.5-flash-lite";
