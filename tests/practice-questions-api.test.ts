import { describe, it, expect } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { topics, questions } from "@/db/schema";
import { GET } from "@/app/api/practice/questions/route";

function randomTestYear(): number {
  return 90000 + (Date.now() % 9000);
}

async function createUserCookie() {
  const email = `aluno-${crypto.randomUUID()}@example.com`;
  await auth.api.signUpEmail({
    body: { email, password: "senha-segura-123", name: "Aluno" },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return signIn.headers.get("set-cookie") ?? "";
}

describe("GET /api/practice/questions", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/practice/questions?topicId=x");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("retorna só questões aprovadas e não-anuladas do topicId, sem correctAnswer", async () => {
    const [topic] = await db
      .insert(topics)
      .values({
        id: crypto.randomUUID(),
        area: "matematica",
        subject: "Matemática",
        name: `Trigonometria ${crypto.randomUUID()}`,
      })
      .returning();

    const alternatives = [
      { letter: "A", text: "1" },
      { letter: "B", text: "2" },
      { letter: "C", text: "3" },
      { letter: "D", text: "4" },
      { letter: "E", text: "5" },
    ];

    await db.insert(questions).values([
      {
        id: crypto.randomUUID(),
        year: randomTestYear(),
        examDay: 1,
        questionNumber: 1,
        area: "matematica",
        statement: "aprovada normal",
        alternatives,
        correctAnswer: "B",
        topicId: topic.id,
        status: "aprovada",
      },
      {
        id: crypto.randomUUID(),
        year: randomTestYear(),
        examDay: 1,
        questionNumber: 2,
        area: "matematica",
        statement: "aprovada mas anulada",
        alternatives,
        correctAnswer: "Anulado",
        topicId: topic.id,
        status: "aprovada",
      },
      {
        id: crypto.randomUUID(),
        year: randomTestYear(),
        examDay: 1,
        questionNumber: 3,
        area: "matematica",
        statement: "ainda pendente",
        alternatives,
        correctAnswer: "A",
        topicId: topic.id,
        status: "pendente",
      },
    ]);

    const cookie = await createUserCookie();
    const request = new Request(
      `http://localhost:3000/api/practice/questions?topicId=${topic.id}`,
      { headers: { cookie } }
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0].statement).toBe("aprovada normal");
    expect(body.questions[0].correctAnswer).toBeUndefined();
    expect(body.questions[0].topic.name).toContain("Trigonometria");
  });
});
