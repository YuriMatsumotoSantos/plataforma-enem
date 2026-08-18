import { describe, it, expect } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { topics, questions } from "@/db/schema";
import { GET } from "@/app/api/practice/subjects/route";

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

async function insertQuestion(overrides: {
  subject: string;
  area: "linguagens" | "humanas" | "natureza" | "matematica";
  status: "pendente" | "aprovada" | "rejeitada";
  correctAnswer?: string;
}) {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: overrides.area,
      subject: overrides.subject,
      name: `Assunto ${crypto.randomUUID()}`,
    })
    .returning();

  await db.insert(questions).values({
    id: crypto.randomUUID(),
    year: randomTestYear(),
    examDay: 1,
    questionNumber: Math.floor(Math.random() * 500) + 1,
    area: overrides.area,
    statement: "teste",
    alternatives: [
      { letter: "A", text: "1" },
      { letter: "B", text: "2" },
      { letter: "C", text: "3" },
      { letter: "D", text: "4" },
      { letter: "E", text: "5" },
    ],
    correctAnswer: overrides.correctAnswer ?? "A",
    topicId: topic.id,
    status: overrides.status,
  });

  return topic;
}

describe("GET /api/practice/subjects", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/practice/subjects");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("lista matérias com contagem de questões aprovadas e não-anuladas", async () => {
    const subjectName = `Física ${crypto.randomUUID()}`;
    await insertQuestion({ subject: subjectName, area: "natureza", status: "aprovada" });
    await insertQuestion({ subject: subjectName, area: "natureza", status: "aprovada" });

    const { cookie } = await createUserCookie();
    const request = new Request("http://localhost:3000/api/practice/subjects", {
      headers: { cookie },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const found = body.subjects.find((s: { subject: string }) => s.subject === subjectName);
    expect(found).toBeDefined();
    expect(found.count).toBe(2);
    expect(found.area).toBe("natureza");
  });

  it("não lista matéria cujas questões são só pendentes/rejeitadas/anuladas", async () => {
    const subjectName = `Química ${crypto.randomUUID()}`;
    await insertQuestion({ subject: subjectName, area: "natureza", status: "pendente" });
    await insertQuestion({ subject: subjectName, area: "natureza", status: "rejeitada" });
    await insertQuestion({
      subject: subjectName,
      area: "natureza",
      status: "aprovada",
      correctAnswer: "Anulado",
    });

    const { cookie } = await createUserCookie();
    const request = new Request("http://localhost:3000/api/practice/subjects", {
      headers: { cookie },
    });
    const response = await GET(request);
    const body = await response.json();
    const found = body.subjects.find((s: { subject: string }) => s.subject === subjectName);
    expect(found).toBeUndefined();
  });
});
