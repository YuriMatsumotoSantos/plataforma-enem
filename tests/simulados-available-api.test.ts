import { describe, it, expect } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";
import { GET } from "@/app/api/simulados/available/route";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 9000);
}

async function createUserCookie() {
  const email = `aluno-${crypto.randomUUID()}@example.com`;
  await auth.api.signUpEmail({ body: { email, password: "senha-segura-123", name: "Aluno" } });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return { cookie: signIn.headers.get("set-cookie") ?? "" };
}

async function insertApprovedQuestion(overrides: {
  year: number;
  examDay: number;
  questionNumber: number;
  area: "linguagens" | "humanas" | "natureza" | "matematica";
}) {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: overrides.area,
      subject: "Assunto teste",
      name: `Tópico ${crypto.randomUUID()}`,
    })
    .returning();

  await db.insert(questions).values({
    id: crypto.randomUUID(),
    year: overrides.year,
    examDay: overrides.examDay,
    questionNumber: overrides.questionNumber,
    area: overrides.area,
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
  });
}

describe("GET /api/simulados/available", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/simulados/available");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("mostra um year+day como disponível só quando chega em 90 aprovadas", async () => {
    const year = randomTestYear();
    for (let i = 0; i < 90; i++) {
      await insertApprovedQuestion({ year, examDay: 1, questionNumber: i + 1, area: "linguagens" });
    }

    const { cookie } = await createUserCookie();
    const request = new Request("http://localhost:3000/api/simulados/available", {
      headers: { cookie },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const found = body.fiel.find(
      (f: { year: number; examDay: number }) => f.year === year && f.examDay === 1
    );
    expect(found.disponivel).toBe(true);
    expect(found.aprovadas).toBe(90);
  });
});
