import { describe, it, expect, vi, afterEach } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { attempts, questions, topics } from "@/db/schema";
import { GET } from "@/app/api/dashboard/route";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 900000);
}

async function createUserSession() {
  const email = `aluno-${crypto.randomUUID()}@example.com`;
  await auth.api.signUpEmail({ body: { email, password: "senha-segura-123", name: "Aluno" } });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  const cookie = signIn.headers.get("set-cookie") ?? "";
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  return { cookie, userId: session!.user.id };
}

describe("GET /api/dashboard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/dashboard");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("um assunto some de vencidos e aparece em fracos logo após uma tentativa errada, e migra para vencidos quando o prazo do FSRS passa", async () => {
    // FSRS never schedules a review for "right now", even on the worst
    // grade (Again) — a fresh card's first review always lands some real
    // time in the future (hours, per ts-fsrs's default parameters). So a
    // single wrong attempt cannot make a topic overdue in the same instant;
    // it raises difficulty (→ fracos) immediately, and only becomes vencido
    // once real time passes the computed dueAt. This test proves both
    // halves: the immediate fracos classification, and the vencidos
    // transition once the clock crosses dueAt — using a faked Date (not
    // real timers, which would also freeze the Postgres driver's own
    // setTimeout-based internals) to simulate that passage of time.
    const { cookie, userId } = await createUserSession();

    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "matematica", subject: "Matemática", name: "Geometria" })
      .returning();

    const alternatives = [
      { letter: "A", text: "1" },
      { letter: "B", text: "2" },
      { letter: "C", text: "3" },
      { letter: "D", text: "4" },
      { letter: "E", text: "5" },
    ];

    const [question] = await db
      .insert(questions)
      .values({
        id: crypto.randomUUID(),
        year: randomTestYear(),
        examDay: 1,
        questionNumber: 1,
        area: "matematica",
        statement: "teste",
        alternatives,
        correctAnswer: "A",
        topicId: topic.id,
        status: "aprovada",
      })
      .returning();

    await db.insert(attempts).values({
      id: crypto.randomUUID(),
      questionId: question.id,
      userId,
      selectedAnswer: "B",
      isCorrect: false,
    });

    const firstRequest = new Request("http://localhost:3000/api/dashboard", {
      headers: { cookie },
    });
    const firstResponse = await GET(firstRequest);
    expect(firstResponse.status).toBe(200);

    const firstBody = await firstResponse.json();
    const notYetDue = firstBody.vencidos.find((v: { topicId: string }) => v.topicId === topic.id);
    expect(notYetDue).toBeUndefined();
    const fraco = firstBody.fracos.find((f: { topicId: string }) => f.topicId === topic.id);
    expect(fraco).toBeDefined();
    expect(fraco.name).toBe("Geometria");

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(new Date(fraco.dueAt).getTime() + 1000));

    const secondRequest = new Request("http://localhost:3000/api/dashboard", {
      headers: { cookie },
    });
    const secondResponse = await GET(secondRequest);
    expect(secondResponse.status).toBe(200);

    const secondBody = await secondResponse.json();
    const vencido = secondBody.vencidos.find((v: { topicId: string }) => v.topicId === topic.id);
    expect(vencido).toBeDefined();
    expect(vencido.name).toBe("Geometria");
  });
});
