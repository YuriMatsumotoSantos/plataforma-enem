import { describe, it, expect } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";
import { GET } from "@/app/api/practice/recommended/route";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 900000);
}

async function createUserCookie() {
  const email = `aluno-${crypto.randomUUID()}@example.com`;
  await auth.api.signUpEmail({ body: { email, password: "senha-segura-123", name: "Aluno" } });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return signIn.headers.get("set-cookie") ?? "";
}

describe("GET /api/practice/recommended", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/practice/recommended");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("para um aluno novo, devolve questões de assuntos nunca praticados", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "matematica", subject: "Matemática", name: `Assunto ${crypto.randomUUID()}` })
      .returning();

    await db.insert(questions).values({
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
      correctAnswer: "A",
      topicId: topic.id,
      status: "aprovada",
    });

    const cookie = await createUserCookie();
    const request = new Request("http://localhost:3000/api/practice/recommended", {
      headers: { cookie },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.questions.some((q: { topic: { id: string } }) => q.topic.id === topic.id)).toBe(
      true
    );
  });
});
