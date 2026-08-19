import { describe, it, expect } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { questions, simulados, topics } from "@/db/schema";
import { GET } from "@/app/api/simulados/[id]/resultado/route";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 900000);
}

async function createUserCookie() {
  const email = `aluno-${crypto.randomUUID()}@example.com`;
  const signUp = await auth.api.signUpEmail({
    body: { email, password: "senha-segura-123", name: "Aluno" },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return { cookie: signIn.headers.get("set-cookie") ?? "", userId: signUp.user.id };
}

async function insertApprovedQuestion(area: "linguagens" | "humanas", correctAnswer = "A") {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area,
      subject: "Assunto teste",
      name: `Tópico ${crypto.randomUUID()}`,
    })
    .returning();

  const [question] = await db
    .insert(questions)
    .values({
      id: crypto.randomUUID(),
      year: randomTestYear(),
      examDay: 1,
      questionNumber: 1,
      area,
      statement: "teste",
      alternatives: [
        { letter: "A", text: "1" },
        { letter: "B", text: "2" },
        { letter: "C", text: "3" },
        { letter: "D", text: "4" },
        { letter: "E", text: "5" },
      ],
      correctAnswer,
      topicId: topic.id,
      status: "aprovada",
    })
    .returning();

  return question;
}

describe("GET /api/simulados/[id]/resultado", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/simulados/x/resultado");
    const response = await GET(request, { params: Promise.resolve({ id: "x" }) });
    expect(response.status).toBe(401);
  });

  it("retorna 403 quando o simulado ainda está em andamento", async () => {
    const question = await insertApprovedQuestion("linguagens");
    const { cookie, userId } = await createUserCookie();
    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId,
        mode: "mesclado",
        examDay: 1,
        questionIds: [question.id],
        durationSeconds: 19800,
      })
      .returning();

    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}/resultado`, {
      headers: { cookie },
    });
    const response = await GET(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(403);
  });

  it("retorna nota por área e a revisão questão a questão", async () => {
    const l1 = await insertApprovedQuestion("linguagens", "A");
    const l2 = await insertApprovedQuestion("linguagens", "B");
    const h1 = await insertApprovedQuestion("humanas", "C");
    const { cookie, userId } = await createUserCookie();

    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId,
        mode: "mesclado",
        examDay: 1,
        questionIds: [l1.id, l2.id, h1.id],
        answers: {
          [l1.id]: { selectedAnswer: "A", markedForReview: false },
          [l2.id]: { selectedAnswer: "X", markedForReview: false },
          [h1.id]: { selectedAnswer: "C", markedForReview: false },
        },
        durationSeconds: 19800,
        status: "finalizado",
        finishedAt: new Date(),
      })
      .returning();

    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}/resultado`, {
      headers: { cookie },
    });
    const response = await GET(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.scoreByArea).toEqual(
      expect.arrayContaining([
        { area: "linguagens", acertos: 1, total: 2 },
        { area: "humanas", acertos: 1, total: 1 },
      ])
    );
    expect(body.questions).toHaveLength(3);
    expect(body.questions.find((q: { id: string }) => q.id === l2.id).selectedAnswer).toBe("X");
  });
});
