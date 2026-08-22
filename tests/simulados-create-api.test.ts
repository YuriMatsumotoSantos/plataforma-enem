import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { questions, simulados, topics } from "@/db/schema";
import { POST, GET } from "@/app/api/simulados/route";
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

async function insertApprovedQuestion(overrides: {
  year: number;
  examDay: number;
  questionNumber: number;
  area: "linguagens" | "humanas" | "natureza" | "matematica";
  correctAnswer?: string;
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

  const [question] = await db
    .insert(questions)
    .values({
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
      correctAnswer: overrides.correctAnswer ?? "A",
      topicId: topic.id,
      status: "aprovada",
    })
    .returning();

  return question;
}

describe("POST /api/simulados", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/simulados", {
      method: "POST",
      body: JSON.stringify({ mode: "fiel", examDay: 1, examYear: 2025 }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("retorna 400 quando o modo fiel pedido ainda não tem 90 aprovadas", async () => {
    const year = randomTestYear();
    const { cookie } = await createUserCookie();
    const request = new Request("http://localhost:3000/api/simulados", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "fiel", examDay: 1, examYear: year }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("cria um simulado fiel com as 90 questões quando disponível", async () => {
    const year = randomTestYear();
    for (let i = 0; i < 90; i++) {
      await insertApprovedQuestion({ year, examDay: 1, questionNumber: i + 1, area: "linguagens" });
    }
    const { cookie, userId } = await createUserCookie();
    const request = new Request("http://localhost:3000/api/simulados", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "fiel", examDay: 1, examYear: year }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();

    const [saved] = await db.select().from(simulados).where(eq(simulados.id, body.id));
    expect(saved.userId).toBe(userId);
    expect(saved.mode).toBe("fiel");
    expect(saved.examYear).toBe(year);
    expect(saved.questionIds).toHaveLength(90);
    expect(saved.durationSeconds).toBe(19800);
    expect(saved.status).toBe("em_andamento");
  });

  it("retorna 402 ao tentar iniciar um segundo simulado no plano grátis", async () => {
    const { cookie, userId } = await createUserCookie();
    await db.insert(simulados).values({
      id: crypto.randomUUID(),
      userId,
      mode: "mesclado",
      examDay: 1,
      questionIds: [],
      durationSeconds: 100,
    });

    const request = new Request("http://localhost:3000/api/simulados", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "mesclado", examDay: 1 }),
    });
    const response = await POST(request);
    expect(response.status).toBe(402);
  });
});

describe("GET /api/simulados", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/simulados");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("lista os simulados do usuário com nota calculada para os finalizados", async () => {
    const question = await insertApprovedQuestion({
      year: randomTestYear(),
      examDay: 1,
      questionNumber: 1,
      area: "linguagens",
    });
    const { cookie, userId } = await createUserCookie();

    await db.insert(simulados).values({
      id: crypto.randomUUID(),
      userId,
      mode: "mesclado",
      examDay: 1,
      questionIds: [question.id],
      answers: { [question.id]: { selectedAnswer: "A", markedForReview: false } },
      durationSeconds: 19800,
      status: "finalizado",
      finishedAt: new Date(),
    });

    const request = new Request("http://localhost:3000/api/simulados", { headers: { cookie } });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.simulados).toHaveLength(1);
    expect(body.simulados[0].score).toEqual({ acertos: 1, total: 1 });
  });
});
