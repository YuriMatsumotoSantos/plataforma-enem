import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user, topics, questions } from "@/db/schema";
import { GET } from "@/app/api/admin/questions/route";
import { PATCH } from "@/app/api/admin/questions/[id]/route";

async function createAdminCookie() {
  const email = `admin-${crypto.randomUUID()}@example.com`;
  const signUp = await auth.api.signUpEmail({
    body: { email, password: "senha-segura-123", name: "Admin" },
  });
  await db.update(user).set({ role: "admin" }).where(eq(user.id, signUp.user.id));
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return signIn.headers.get("set-cookie") ?? "";
}

describe("GET /api/admin/questions", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/admin/questions");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("retorna as questões pendentes para um admin", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "natureza", subject: "Física", name: "Óptica" })
      .returning();

    const testYear = 2000 + Math.floor(Math.random() * 100);
    const testDay = Math.floor(Math.random() * 2) + 1;
    const testNumber = Math.floor(Math.random() * 100) + 1;

    await db.insert(questions).values({
      id: crypto.randomUUID(),
      year: testYear,
      examDay: testDay,
      questionNumber: testNumber,
      area: "natureza",
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
      status: "pendente",
    });

    const cookie = await createAdminCookie();
    const request = new Request(
      "http://localhost:3000/api/admin/questions?status=pendente",
      { headers: { cookie } }
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const found = body.questions.find((q: { year: number }) => q.year === testYear);
    expect(found).toBeDefined();
    expect(found.topic.name).toBe("Óptica");
  });
});

describe("PATCH /api/admin/questions/:id", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/admin/questions/x", {
      method: "PATCH",
      body: JSON.stringify({ status: "aprovada" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "x" }) });
    expect(response.status).toBe(401);
  });

  it("aprova uma questão e persiste o novo status", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "matematica", subject: "Matemática", name: "Geometria" })
      .returning();

    const testYear = 2000 + Math.floor(Math.random() * 100);
    const testDay = Math.floor(Math.random() * 2) + 1;
    const testNumber = Math.floor(Math.random() * 100) + 1;

    const [question] = await db
      .insert(questions)
      .values({
        id: crypto.randomUUID(),
        year: testYear,
        examDay: testDay,
        questionNumber: testNumber,
        area: "matematica",
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
        status: "pendente",
      })
      .returning();

    const cookie = await createAdminCookie();
    const request = new Request(
      `http://localhost:3000/api/admin/questions/${question.id}`,
      {
        method: "PATCH",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "aprovada" }),
      }
    );
    const response = await PATCH(request, { params: Promise.resolve({ id: question.id }) });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("aprovada");
  });

  it("retorna 400 para corpo de requisição JSON inválido", async () => {
    const cookie = await createAdminCookie();
    const request = new Request(
      `http://localhost:3000/api/admin/questions/x`,
      {
        method: "PATCH",
        headers: { cookie, "Content-Type": "application/json" },
        body: "{ invalid json",
      }
    );
    const response = await PATCH(request, { params: Promise.resolve({ id: "x" }) });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Corpo da requisição inválido");
  });

  it("retorna 400 para status inválido", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "natureza", subject: "Física", name: "Mecânica" })
      .returning();

    const testYear = 2000 + Math.floor(Math.random() * 100);
    const testDay = Math.floor(Math.random() * 2) + 1;
    const testNumber = Math.floor(Math.random() * 100) + 1;

    const [question] = await db
      .insert(questions)
      .values({
        id: crypto.randomUUID(),
        year: testYear,
        examDay: testDay,
        questionNumber: testNumber,
        area: "natureza",
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
        status: "pendente",
      })
      .returning();

    const cookie = await createAdminCookie();
    const request = new Request(
      `http://localhost:3000/api/admin/questions/${question.id}`,
      {
        method: "PATCH",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "nao-existe" }),
      }
    );
    const response = await PATCH(request, { params: Promise.resolve({ id: question.id }) });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Status inválido");
  });
});
