import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user, topics, questions } from "@/db/schema";
import { GET } from "@/app/api/admin/questions/route";

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
