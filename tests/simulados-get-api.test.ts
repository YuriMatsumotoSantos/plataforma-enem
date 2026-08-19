import { describe, it, expect } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { questions, simulados, topics } from "@/db/schema";
import { GET } from "@/app/api/simulados/[id]/route";

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

describe("GET /api/simulados/[id]", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/simulados/x");
    const response = await GET(request, { params: Promise.resolve({ id: "x" }) });
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
    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}`, {
      headers: { cookie: other.cookie },
    });
    const response = await GET(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(404);
  });

  it("retorna o pacote completo na ordem de questionIds, com respostas atuais", async () => {
    const q1 = await insertApprovedQuestion();
    const q2 = await insertApprovedQuestion();
    const { cookie, userId } = await createUserCookie();
    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId,
        mode: "mesclado",
        examDay: 1,
        questionIds: [q2.id, q1.id],
        answers: { [q2.id]: { selectedAnswer: "B", markedForReview: true } },
        durationSeconds: 19800,
      })
      .returning();

    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}`, {
      headers: { cookie },
    });
    const response = await GET(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.questions.map((q: { id: string }) => q.id)).toEqual([q2.id, q1.id]);
    expect(body.answers[q2.id]).toEqual({ selectedAnswer: "B", markedForReview: true });
  });
});
