import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/anthropic", () => ({
  getAnthropicClient: vi.fn(),
  ANTHROPIC_MODEL: "claude-sonnet-5",
}));

import { getAnthropicClient } from "@/lib/anthropic";
import { gradeRedacao } from "@/lib/redacao";

function mockClientWithToolInput(input: Record<string, unknown>) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: "tool_use", id: "tool_1", name: "submit_grade", input }],
  });
  vi.mocked(getAnthropicClient).mockReturnValue({
    messages: { create },
  } as unknown as ReturnType<typeof getAnthropicClient>);
  return create;
}

describe("gradeRedacao", () => {
  beforeEach(() => {
    vi.mocked(getAnthropicClient).mockReset();
  });

  it("retorna as notas e soma a nota total corretamente quando a IA responde valores válidos", async () => {
    mockClientWithToolInput({
      competencia1: 200,
      competencia2: 160,
      competencia3: 120,
      competencia4: 200,
      competencia5: 160,
      justificativas: ["a", "b", "c", "d", "e"],
      comentarioGeral: "Muito bom.",
    });

    const result = await gradeRedacao("Tema de teste", "Texto do aluno.");

    expect(result.scores).toEqual({
      competencia1: 200,
      competencia2: 160,
      competencia3: 120,
      competencia4: 200,
      competencia5: 160,
    });
    expect(result.notaTotal).toBe(840);
    expect(result.feedback.justificativas).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.feedback.comentarioGeral).toBe("Muito bom.");
  });

  it("arredonda uma nota fora da rubrica para o valor válido mais próximo", async () => {
    mockClientWithToolInput({
      competencia1: 190, // mais perto de 200 que de 160
      competencia2: 55, // mais perto de 40 que de 80
      competencia3: 0,
      competencia4: 0,
      competencia5: 0,
      justificativas: ["a", "b", "c", "d", "e"],
      comentarioGeral: "",
    });

    const result = await gradeRedacao("Tema de teste", "Texto do aluno.");

    expect(result.scores.competencia1).toBe(200);
    expect(result.scores.competencia2).toBe(40);
  });

  it("lança erro quando a IA não retorna um bloco tool_use", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "desculpe" }] });
    vi.mocked(getAnthropicClient).mockReturnValue({
      messages: { create },
    } as unknown as ReturnType<typeof getAnthropicClient>);

    await expect(gradeRedacao("Tema de teste", "Texto do aluno.")).rejects.toThrow(
      "IA não retornou o schema esperado"
    );
  });

  it("lança erro quando uma competência vem ausente/não numérica no tool_use", async () => {
    mockClientWithToolInput({
      competencia1: 200,
      competencia2: 160,
      // competencia3 ausente
      competencia4: 200,
      competencia5: 160,
      justificativas: ["a", "b", "c", "d", "e"],
      comentarioGeral: "Muito bom.",
    });

    await expect(gradeRedacao("Tema de teste", "Texto do aluno.")).rejects.toThrow(
      "IA não retornou o schema esperado"
    );
  });

  it("preenche justificativas ausentes com string vazia em vez de quebrar", async () => {
    mockClientWithToolInput({
      competencia1: 0,
      competencia2: 0,
      competencia3: 0,
      competencia4: 0,
      competencia5: 0,
      justificativas: ["só uma"],
      comentarioGeral: "",
    });

    const result = await gradeRedacao("Tema de teste", "Texto do aluno.");
    expect(result.feedback.justificativas).toHaveLength(5);
    expect(result.feedback.justificativas[0]).toBe("só uma");
    expect(result.feedback.justificativas[1]).toBe("");
  });
});
