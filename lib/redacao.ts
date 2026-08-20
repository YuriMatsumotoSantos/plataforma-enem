import { getAnthropicClient, ANTHROPIC_MODEL } from "@/lib/anthropic";
import type { RedacaoScores, RedacaoFeedback } from "@/db/schema";

const VALID_SCORES = [0, 40, 80, 120, 160, 200];

function clampScore(value: unknown): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return VALID_SCORES.reduce((closest, candidate) =>
    Math.abs(candidate - num) < Math.abs(closest - num) ? candidate : closest
  );
}

// Critérios oficiais das 5 competências do ENEM (informação pública do INEP),
// usados como instrução de sistema para a correção.
const RUBRIC = `Competência 1: domínio da modalidade escrita formal da língua portuguesa.
Competência 2: compreender a proposta e aplicar conceitos de várias áreas de conhecimento para desenvolver o tema, dentro da estrutura do texto dissertativo-argumentativo.
Competência 3: selecionar, relacionar, organizar e interpretar informações, fatos, opiniões e argumentos em defesa de um ponto de vista.
Competência 4: conhecimento dos mecanismos linguísticos necessários para a construção da argumentação.
Competência 5: elaborar proposta de intervenção para o problema abordado, respeitando os direitos humanos.
Cada competência vale exatamente 0, 40, 80, 120, 160 ou 200 pontos - nunca um valor intermediário.`;

export async function gradeRedacao(
  temaTitle: string,
  text: string
): Promise<{ scores: RedacaoScores; notaTotal: number; feedback: RedacaoFeedback }> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 2048,
    system: `Você é um corretor oficial de redações do ENEM. Avalie o texto do aluno segundo as 5 competências oficiais, com rigor e imparcialidade:\n${RUBRIC}`,
    messages: [
      {
        role: "user",
        content: `Tema da redação: "${temaTitle}"\n\nTexto do aluno:\n${text}`,
      },
    ],
    tools: [
      {
        name: "submit_grade",
        description: "Submete a nota da redação nas 5 competências do ENEM.",
        input_schema: {
          type: "object",
          properties: {
            competencia1: { type: "integer", enum: VALID_SCORES },
            competencia2: { type: "integer", enum: VALID_SCORES },
            competencia3: { type: "integer", enum: VALID_SCORES },
            competencia4: { type: "integer", enum: VALID_SCORES },
            competencia5: { type: "integer", enum: VALID_SCORES },
            justificativas: {
              type: "array",
              items: { type: "string" },
              minItems: 5,
              maxItems: 5,
              description: "Uma justificativa curta por competência, na mesma ordem (1 a 5).",
            },
            comentarioGeral: { type: "string" },
          },
          required: [
            "competencia1",
            "competencia2",
            "competencia3",
            "competencia4",
            "competencia5",
            "justificativas",
            "comentarioGeral",
          ],
        },
      },
    ],
    tool_choice: { type: "tool", name: "submit_grade" },
  });

  const toolUse = response.content.find(
    (block): block is Extract<(typeof response.content)[number], { type: "tool_use" }> =>
      block.type === "tool_use"
  );

  if (!toolUse) {
    throw new Error("IA não retornou o schema esperado");
  }

  const input = toolUse.input as Record<string, unknown>;

  const scores: RedacaoScores = {
    competencia1: clampScore(input.competencia1),
    competencia2: clampScore(input.competencia2),
    competencia3: clampScore(input.competencia3),
    competencia4: clampScore(input.competencia4),
    competencia5: clampScore(input.competencia5),
  };

  const notaTotal =
    scores.competencia1 +
    scores.competencia2 +
    scores.competencia3 +
    scores.competencia4 +
    scores.competencia5;

  const rawJustificativas = Array.isArray(input.justificativas) ? input.justificativas : [];
  const justificativas = Array.from({ length: 5 }, (_, i) =>
    typeof rawJustificativas[i] === "string" ? (rawJustificativas[i] as string) : ""
  );

  const feedback: RedacaoFeedback = {
    justificativas,
    comentarioGeral: typeof input.comentarioGeral === "string" ? input.comentarioGeral : "",
  };

  return { scores, notaTotal, feedback };
}
