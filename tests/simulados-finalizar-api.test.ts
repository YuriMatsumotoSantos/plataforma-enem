import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { attempts, questions, simulados, topics } from "@/db/schema";
import { POST } from "@/app/api/simulados/[id]/finalizar/route";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 9000);
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

async function insertApprovedQuestion(correctAnswer = "A") {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: "linguagens",
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
      area: "linguagens",
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

describe("POST /api/simulados/[id]/finalizar", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/simulados/x/finalizar", {
      method: "POST",
    });
    const response = await POST(request, { params: Promise.resolve({ id: "x" }) });
    expect(response.status).toBe(401);
  });

  it("marca finalizado e grava attempts só das questões respondidas e não-anuladas", async () => {
    const answered = await insertApprovedQuestion("A");
    const blank = await insertApprovedQuestion("B");
    const anulada = await insertApprovedQuestion("Anulado");
    const { cookie, userId } = await createUserCookie();

    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId,
        mode: "mesclado",
        examDay: 1,
        questionIds: [answered.id, blank.id, anulada.id],
        answers: {
          [answered.id]: { selectedAnswer: "A", markedForReview: false },
          [anulada.id]: { selectedAnswer: "C", markedForReview: false },
        },
        durationSeconds: 19800,
      })
      .returning();

    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}/finalizar`, {
      method: "POST",
      headers: { cookie },
    });
    const response = await POST(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(200);

    const [saved] = await db.select().from(simulados).where(eq(simulados.id, simulado.id));
    expect(saved.status).toBe("finalizado");
    expect(saved.finishedAt).not.toBeNull();

    const answeredAttempts = await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.userId, userId), eq(attempts.questionId, answered.id)));
    expect(answeredAttempts).toHaveLength(1);
    expect(answeredAttempts[0].isCorrect).toBe(true);

    const anuladaAttempts = await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.userId, userId), eq(attempts.questionId, anulada.id)));
    expect(anuladaAttempts).toHaveLength(0);

    const blankAttempts = await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.userId, userId), eq(attempts.questionId, blank.id)));
    expect(blankAttempts).toHaveLength(0);
  });

  it("retorna 400 ao tentar finalizar de novo um simulado já finalizado", async () => {
    const question = await insertApprovedQuestion();
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
        status: "finalizado",
        finishedAt: new Date(),
      })
      .returning();

    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}/finalizar`, {
      method: "POST",
      headers: { cookie },
    });
    const response = await POST(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(400);
  });
});
