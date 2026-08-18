import { describe, it, expect } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { topics, questions } from "@/db/schema";
import { GET } from "@/app/api/practice/topics/route";

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

describe("GET /api/practice/topics", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/practice/topics?subject=Física");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("lista assuntos de uma matéria com contagem de questões aprovadas", async () => {
    const subjectName = `Biologia ${crypto.randomUUID()}`;
    const [topic] = await db
      .insert(topics)
      .values({
        id: crypto.randomUUID(),
        area: "natureza",
        subject: subjectName,
        name: "Genética",
      })
      .returning();

    for (let i = 0; i < 3; i++) {
      await db.insert(questions).values({
        id: crypto.randomUUID(),
        year: randomTestYear(),
        examDay: 1,
        questionNumber: 100 + i,
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
        status: "aprovada",
      });
    }

    const cookie = await createUserCookie();
    const request = new Request(
      `http://localhost:3000/api/practice/topics?subject=${encodeURIComponent(subjectName)}`,
      { headers: { cookie } }
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.topics).toHaveLength(1);
    expect(body.topics[0]).toMatchObject({ id: topic.id, name: "Genética", count: 3 });
  });

  it("retorna lista vazia para subject inexistente, sem erro", async () => {
    const cookie = await createUserCookie();
    const request = new Request(
      "http://localhost:3000/api/practice/topics?subject=NaoExiste12345",
      { headers: { cookie } }
    );
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.topics).toEqual([]);
  });
});
