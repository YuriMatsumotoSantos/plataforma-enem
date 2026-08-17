import { readFile } from "node:fs/promises";
import { gemini, GEMINI_MODEL } from "@/lib/gemini";
import type { ExtractedQuestion, GabaritoEntry } from "./types";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionNumber: { type: "integer" },
          correctAnswer: { type: "string" },
        },
        required: ["questionNumber", "correctAnswer"],
      },
    },
  },
  required: ["answers"],
};

const PROMPT = `Este é o gabarito oficial do ENEM. Extraia o número de cada questão e a
letra da alternativa correta (A, B, C, D ou E) correspondente.`;

export async function extractGabaritoFromPdf(
  pdfPath: string
): Promise<GabaritoEntry[]> {
  const fileBuffer = await readFile(pdfPath);
  const base64Data = fileBuffer.toString("base64");

  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "application/pdf", data: base64Data } },
          { text: PROMPT },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini não retornou conteúdo para extração do gabarito");
  }

  const parsed = JSON.parse(text) as { answers: GabaritoEntry[] };
  return parsed.answers;
}

export function mergeGabarito(
  questions: ExtractedQuestion[],
  gabarito: GabaritoEntry[]
): (ExtractedQuestion & { correctAnswer: string })[] {
  const answerByNumber = new Map(
    gabarito.map((entry) => [entry.questionNumber, entry.correctAnswer])
  );

  return questions.map((question) => {
    const correctAnswer = answerByNumber.get(question.questionNumber);
    if (!correctAnswer) {
      throw new Error(
        `Sem gabarito para a questão número ${question.questionNumber}`
      );
    }
    return { ...question, correctAnswer };
  });
}
