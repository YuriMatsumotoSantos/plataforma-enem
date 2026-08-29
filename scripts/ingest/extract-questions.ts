import { readFile } from "node:fs/promises";
import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini";
import { withHeartbeat } from "./heartbeat";
import type { ExtractedQuestion } from "./types";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionNumber: { type: "integer" },
          statement: { type: "string" },
          alternatives: {
            type: "array",
            items: {
              type: "object",
              properties: {
                letter: { type: "string" },
                text: { type: "string" },
              },
              required: ["letter", "text"],
            },
          },
          hasImage: { type: "boolean" },
          pageNumber: { type: "integer" },
          area: {
            type: "string",
            enum: ["linguagens", "humanas", "natureza", "matematica"],
          },
          subject: { type: "string" },
          topic: { type: "string" },
        },
        required: [
          "questionNumber",
          "statement",
          "alternatives",
          "hasImage",
          "pageNumber",
          "area",
          "subject",
          "topic",
        ],
      },
    },
  },
  required: ["questions"],
};

const PROMPT = `Você está lendo o caderno de provas do ENEM (Exame Nacional do Ensino
Médio brasileiro). Extraia TODAS as questões objetivas de múltipla escolha deste
documento (ignore a proposta de redação, se houver).

Para cada questão, retorne: número da questão, enunciado completo, as 5
alternativas (A a E) com o texto de cada uma, se a questão tem uma figura/imagem
associada (hasImage), o número da página do PDF onde a questão aparece
(pageNumber, começando em 1), a área do conhecimento (area: linguagens, humanas,
natureza ou matematica), a disciplina específica (subject, ex: "Física",
"História", "Língua Portuguesa") e o assunto específico dentro da disciplina
(topic, ex: "Óptica — Lentes", "Revolução Industrial").

IMPORTANTE — textos de apoio compartilhados: é muito comum no ENEM um único
texto-base (uma crônica, tirinha, gráfico, trecho de reportagem etc.) servir de
apoio para várias questões seguidas (ex.: um texto acima das questões 6 a 10).
Cada questão precisa ser autossuficiente: se uma questão depende de um texto de
apoio que não é exclusivo dela, copie o texto de apoio INTEIRO para dentro do
campo "statement" dessa questão, antes da pergunta específica — mesmo que isso
signifique repetir o mesmo texto de apoio em várias questões consecutivas. Nunca
deixe uma questão cujo enunciado só faça sentido junto de outra.

Não invente conteúdo: se não conseguir ler uma questão com confiança, ainda
assim inclua o que conseguir extrair com a maior fidelidade possível ao
enunciado original.`;

export async function extractQuestionsFromPdf(
  pdfPath: string,
  examDay: 1 | 2
): Promise<ExtractedQuestion[]> {
  const fileBuffer = await readFile(pdfPath);
  const base64Data = fileBuffer.toString("base64");

  const response = await withHeartbeat(
    `extração de questões do dia ${examDay}`,
    getGeminiClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "application/pdf", data: base64Data } },
            { text: `${PROMPT}\n\nEste é o caderno do dia ${examDay} do ENEM.` },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    })
  );

  const text = response.text;
  if (!text) {
    throw new Error("Gemini não retornou conteúdo para extração de questões");
  }

  const parsed = JSON.parse(text) as { questions: ExtractedQuestion[] };
  return parsed.questions;
}
