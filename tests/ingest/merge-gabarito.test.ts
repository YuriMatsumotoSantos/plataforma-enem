import { describe, it, expect } from "vitest";
import { mergeGabarito } from "@/scripts/ingest/extract-gabarito";
import type { ExtractedQuestion } from "@/scripts/ingest/types";

const baseQuestion: ExtractedQuestion = {
  questionNumber: 91,
  statement: "...",
  alternatives: [
    { letter: "A", text: "1" },
    { letter: "B", text: "2" },
    { letter: "C", text: "3" },
    { letter: "D", text: "4" },
    { letter: "E", text: "5" },
  ],
  hasImage: false,
  pageNumber: 12,
  area: "natureza",
  subject: "Física",
  topic: "Óptica",
};

describe("mergeGabarito", () => {
  it("junta o gabarito correto pela numeração da questão", () => {
    const result = mergeGabarito(
      [baseQuestion],
      [{ questionNumber: 91, correctAnswer: "C" }]
    );
    expect(result[0].correctAnswer).toBe("C");
  });

  it("lança erro quando falta gabarito para uma questão", () => {
    expect(() => mergeGabarito([baseQuestion], [])).toThrow(
      "Sem gabarito para a questão número 91"
    );
  });
});
