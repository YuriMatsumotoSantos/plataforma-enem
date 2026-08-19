import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { questions, simulados, topics } from "@/db/schema";
import { PATCH } from "@/app/api/simulados/[id]/respostas/route";
import { randomTestYear } from "@/tests/helpers";

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

async function insertApprovedQuestion() {
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
      correctAnswer: "A",
      topicId: topic.id,
      status: "aprovada",
    })
    .returning();

  return question;
}

describe("PATCH /api/simulados/[id]/respostas", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/simulados/x/respostas", {
      method: "PATCH",
      body: JSON.stringify({ questionId: "x", selectedAnswer: "A" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "x" }) });
    expect(response.status).toBe(401);
  });

  it("retorna 404 quando o simulado é de outro usuário", async () => {
    const question = await insertApprovedQuestion();
    const owner = await createUserCookie();
    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId: owner.userId,
        mode: "mesclado",
        examDay: 1,
        questionIds: [question.id],
        durationSeconds: 19800,
      })
      .returning();

    const other = await createUserCookie();
    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}/respostas`, {
      method: "PATCH",
      headers: { cookie: other.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: question.id, selectedAnswer: "A" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(404);
  });

  it("retorna 400 quando a questão não pertence ao simulado", async () => {
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
      })
      .returning();

    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}/respostas`, {
      method: "PATCH",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: crypto.randomUUID(), selectedAnswer: "A" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(400);
  });

  it("salva selectedAnswer e markedForReview separadamente, sem apagar o outro campo", async () => {
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
      })
      .returning();

    const firstRequest = new Request(
      `http://localhost:3000/api/simulados/${simulado.id}/respostas`,
      {
        method: "PATCH",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, selectedAnswer: "B" }),
      }
    );
    expect(
      (await PATCH(firstRequest, { params: Promise.resolve({ id: simulado.id }) })).status
    ).toBe(200);

    const secondRequest = new Request(
      `http://localhost:3000/api/simulados/${simulado.id}/respostas`,
      {
        method: "PATCH",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, markedForReview: true }),
      }
    );
    expect(
      (await PATCH(secondRequest, { params: Promise.resolve({ id: simulado.id }) })).status
    ).toBe(200);

    const [saved] = await db.select().from(simulados).where(eq(simulados.id, simulado.id));
    expect(saved.answers[question.id]).toEqual({ selectedAnswer: "B", markedForReview: true });
  });

  it("patchear a questão B não apaga a resposta já salva da questão A", async () => {
    const questionA = await insertApprovedQuestion();
    const questionB = await insertApprovedQuestion();
    const { cookie, userId } = await createUserCookie();
    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId,
        mode: "mesclado",
        examDay: 1,
        questionIds: [questionA.id, questionB.id],
        durationSeconds: 19800,
      })
      .returning();

    const requestA = new Request(
      `http://localhost:3000/api/simulados/${simulado.id}/respostas`,
      {
        method: "PATCH",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: questionA.id, selectedAnswer: "C" }),
      }
    );
    expect(
      (await PATCH(requestA, { params: Promise.resolve({ id: simulado.id }) })).status
    ).toBe(200);

    const requestB = new Request(
      `http://localhost:3000/api/simulados/${simulado.id}/respostas`,
      {
        method: "PATCH",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: questionB.id, selectedAnswer: "D" }),
      }
    );
    expect(
      (await PATCH(requestB, { params: Promise.resolve({ id: simulado.id }) })).status
    ).toBe(200);

    const [saved] = await db.select().from(simulados).where(eq(simulados.id, simulado.id));
    expect(saved.answers[questionA.id]).toEqual({ selectedAnswer: "C", markedForReview: false });
    expect(saved.answers[questionB.id]).toEqual({ selectedAnswer: "D", markedForReview: false });
  });

  it("retorna 400 ao tentar responder um simulado já finalizado", async () => {
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

    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}/respostas`, {
      method: "PATCH",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: question.id, selectedAnswer: "A" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(400);
  });
});
