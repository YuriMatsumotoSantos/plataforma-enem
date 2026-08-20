import { describe, it, expect } from "vitest";
import { selectRecommendedTopics, type CandidateTopic } from "@/lib/recommended-session";

function makeTopic(id: string): CandidateTopic {
  return { topicId: id, subject: "Matemática", area: "matematica", name: `Assunto ${id}` };
}

describe("selectRecommendedTopics", () => {
  it("prioriza vencidos, depois fracos, depois nunca-praticados, até o limite", () => {
    const vencidos = [makeTopic("v1"), makeTopic("v2")];
    const fracos = [makeTopic("f1"), makeTopic("f2")];
    const neverAttempted = [makeTopic("n1"), makeTopic("n2")];

    const result = selectRecommendedTopics(vencidos, fracos, neverAttempted, 5);

    expect(result.map((t) => t.topicId)).toEqual(["v1", "v2", "f1", "f2", "n1"]);
  });

  it("não repete um topicId presente em mais de uma lista", () => {
    const vencidos = [makeTopic("shared")];
    const fracos = [makeTopic("shared"), makeTopic("f1")];
    const neverAttempted: CandidateTopic[] = [];

    const result = selectRecommendedTopics(vencidos, fracos, neverAttempted, 5);

    expect(result.map((t) => t.topicId)).toEqual(["shared", "f1"]);
  });

  it("sem vencidos nem fracos, cai inteiramente para nunca-praticados", () => {
    const neverAttempted = [makeTopic("n1"), makeTopic("n2"), makeTopic("n3")];

    const result = selectRecommendedTopics([], [], neverAttempted, 5);

    expect(result.map((t) => t.topicId)).toEqual(["n1", "n2", "n3"]);
  });

  it("respeita o limite mesmo com candidatos de sobra", () => {
    const neverAttempted = [makeTopic("n1"), makeTopic("n2"), makeTopic("n3")];
    const result = selectRecommendedTopics([], [], neverAttempted, 2);
    expect(result).toHaveLength(2);
  });
});
