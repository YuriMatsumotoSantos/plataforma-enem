import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { attempts, topics, questions } from "@/db/schema";
import { POST } from "@/app/api/practice/attempts/route";

function randomTestYear(): number {
  return 90000 + (Date.now() % 9000);
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

async function createApprovedQuestion() {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: "matematica",
      subject: "Matemática",
      name: `Assunto ${crypto.randomUUID()}`,
    })
    .returning();

  const [question] = await db
    .insert(questions)
    .values({
      id: crypto.randomUUID(),
      year: randomTestYear(),
      examDay: 1,
      questionNumber: 1,
      area: "matematica",
      statement: "teste",
      alternatives: [
        { letter: "A", text: "1" },
        { letter: "B", text: "2" },
        { letter: "C", text: "3" },
        { letter: "D", text: "4" },
        { letter: "E", text: "5" },
      ],
      correctAnswer: "C",
      topicId: topic.id,
      status: "aprovada",
    })
    .returning();

  return question;
}

describe("POST /api/practice/attempts", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/practice/attempts", {
      method: "POST",
      body: JSON.stringify({ questionId: "x", selectedAnswer: "A" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("retorna 400 para corpo inválido", async () => {
    const { cookie } = await createUserCookie();
    const request = new Request("http://localhost:3000/api/practice/attempts", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: 123 }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("retorna 404 para questionId inexistente", async () => {
    const { cookie } = await createUserCookie();
    const request = new Request("http://localhost:3000/api/practice/attempts", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: crypto.randomUUID(), selectedAnswer: "A" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(404);
  });

  it("retorna 400 para selectedAnswer que não é uma alternativa real da questão", async () => {
    const question = await createApprovedQuestion();
    const { cookie } = await createUserCookie();
    const request = new Request("http://localhost:3000/api/practice/attempts", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: question.id, selectedAnswer: "Z" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("calcula isCorrect corretamente e grava a tentativa no banco", async () => {
    const question = await createApprovedQuestion();
    const { cookie, userId } = await createUserCookie();

    const correctRequest = new Request("http://localhost:3000/api/practice/attempts", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: question.id, selectedAnswer: "C" }),
    });
    const correctResponse = await POST(correctRequest);
    expect(correctResponse.status).toBe(200);
    const correctBody = await correctResponse.json();
    expect(correctBody).toEqual({ isCorrect: true, correctAnswer: "C" });

    const wrongRequest = new Request("http://localhost:3000/api/practice/attempts", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: question.id, selectedAnswer: "A" }),
    });
    const wrongResponse = await POST(wrongRequest);
    const wrongBody = await wrongResponse.json();
    expect(wrongBody).toEqual({ isCorrect: false, correctAnswer: "C" });

    const saved = await db.select().from(attempts).where(eq(attempts.userId, userId));
    expect(saved).toHaveLength(2);
    expect(saved.map((a) => a.isCorrect).sort()).toEqual([false, true]);
  });

  it("retorna 402 ao atingir o limite diário do plano grátis", async () => {
    const question = await createApprovedQuestion();
    const { cookie, userId } = await createUserCookie();

    for (let i = 0; i < 20; i++) {
      await db.insert(attempts).values({
        id: crypto.randomUUID(),
        questionId: question.id,
        userId,
        selectedAnswer: "A",
        isCorrect: true,
      });
    }

    const request = new Request("http://localhost:3000/api/practice/attempts", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: question.id, selectedAnswer: "A" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(402);
  });
});
