import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { user, subscriptions, attempts, simulados, redacoes, temas, topics, questions } from "@/db/schema";
import {
  getUserPlan,
  canPracticeToday,
  canStartSimulado,
  canSubmitRedacao,
} from "@/lib/entitlements";

async function createTestUser() {
  const [row] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Aluno Teste",
      email: `entitlements-${crypto.randomUUID()}@example.com`,
      emailVerified: false,
    })
    .returning();
  return row;
}

function randomTestYear(): number {
  return 90000 + (Date.now() % 9000);
}

async function createTestQuestion() {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: "matematica",
      subject: "Álgebra",
      name: "Equações",
    })
    .returning();

  const testYear = randomTestYear();
  const testDay = Math.floor(Math.random() * 2) + 1;
  const testNumber = Math.floor(Math.random() * 180) + 1;

  const [question] = await db
    .insert(questions)
    .values({
      id: crypto.randomUUID(),
      year: testYear,
      examDay: testDay,
      questionNumber: testNumber,
      area: "matematica",
      statement: "Teste questão",
      alternatives: [
        { letter: "A", text: "1" },
        { letter: "B", text: "2" },
        { letter: "C", text: "3" },
        { letter: "D", text: "4" },
        { letter: "E", text: "5" },
      ],
      correctAnswer: "A",
      topicId: topic.id,
    })
    .returning();

  return question;
}

async function makePremium(userId: string, periodEndOffsetMs: number) {
  await db.insert(subscriptions).values({
    id: crypto.randomUUID(),
    userId,
    stripeCustomerId: `cus_${crypto.randomUUID()}`,
    stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
    status: "active",
    currentPeriodEnd: new Date(Date.now() + periodEndOffsetMs),
  });
}

describe("getUserPlan", () => {
  it("retorna free quando não há linha em subscriptions", async () => {
    const testUser = await createTestUser();
    expect(await getUserPlan(testUser.id)).toBe("free");
  });

  it("retorna premium quando status é active e currentPeriodEnd está no futuro", async () => {
    const testUser = await createTestUser();
    await makePremium(testUser.id, 30 * 24 * 60 * 60 * 1000);
    expect(await getUserPlan(testUser.id)).toBe("premium");
  });

  it("retorna free quando currentPeriodEnd já passou, mesmo com status active", async () => {
    const testUser = await createTestUser();
    await makePremium(testUser.id, -1000);
    expect(await getUserPlan(testUser.id)).toBe("free");
  });

  it("retorna free quando status é canceled", async () => {
    const testUser = await createTestUser();
    await db.insert(subscriptions).values({
      id: crypto.randomUUID(),
      userId: testUser.id,
      stripeCustomerId: `cus_${crypto.randomUUID()}`,
      stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
      status: "canceled",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    expect(await getUserPlan(testUser.id)).toBe("free");
  });
});

describe("canPracticeToday", () => {
  it("permite quando o usuário ainda não respondeu nada hoje", async () => {
    const testUser = await createTestUser();
    expect(await canPracticeToday(testUser.id)).toBe(true);
  });

  it("bloqueia ao atingir 20 tentativas hoje no plano grátis", async () => {
    const testUser = await createTestUser();
    const question = await createTestQuestion();
    for (let i = 0; i < 20; i++) {
      await db.insert(attempts).values({
        id: crypto.randomUUID(),
        questionId: question.id,
        userId: testUser.id,
        selectedAnswer: "A",
        isCorrect: true,
      });
    }
    expect(await canPracticeToday(testUser.id)).toBe(false);
  });

  it("não bloqueia usuário premium mesmo acima de 20 tentativas hoje", async () => {
    const testUser = await createTestUser();
    await makePremium(testUser.id, 30 * 24 * 60 * 60 * 1000);
    const question = await createTestQuestion();
    for (let i = 0; i < 25; i++) {
      await db.insert(attempts).values({
        id: crypto.randomUUID(),
        questionId: question.id,
        userId: testUser.id,
        selectedAnswer: "A",
        isCorrect: true,
      });
    }
    expect(await canPracticeToday(testUser.id)).toBe(true);
  });

  it("não conta tentativas de outro usuário", async () => {
    const testUser = await createTestUser();
    const otherUser = await createTestUser();
    const question = await createTestQuestion();
    for (let i = 0; i < 20; i++) {
      await db.insert(attempts).values({
        id: crypto.randomUUID(),
        questionId: question.id,
        userId: otherUser.id,
        selectedAnswer: "A",
        isCorrect: true,
      });
    }
    expect(await canPracticeToday(testUser.id)).toBe(true);
  });
});

describe("canStartSimulado", () => {
  it("permite o primeiro simulado no plano grátis", async () => {
    const testUser = await createTestUser();
    expect(await canStartSimulado(testUser.id)).toBe(true);
  });

  it("bloqueia o segundo simulado no plano grátis", async () => {
    const testUser = await createTestUser();
    await db.insert(simulados).values({
      id: crypto.randomUUID(),
      userId: testUser.id,
      mode: "mesclado",
      examDay: 1,
      questionIds: [],
      durationSeconds: 100,
    });
    expect(await canStartSimulado(testUser.id)).toBe(false);
  });

  it("não bloqueia usuário premium no segundo simulado", async () => {
    const testUser = await createTestUser();
    await makePremium(testUser.id, 30 * 24 * 60 * 60 * 1000);
    await db.insert(simulados).values({
      id: crypto.randomUUID(),
      userId: testUser.id,
      mode: "mesclado",
      examDay: 1,
      questionIds: [],
      durationSeconds: 100,
    });
    expect(await canStartSimulado(testUser.id)).toBe(true);
  });
});

describe("canSubmitRedacao", () => {
  async function createTema() {
    const [tema] = await db
      .insert(temas)
      .values({ id: crypto.randomUUID(), title: `Tema entitlements ${crypto.randomUUID()}` })
      .returning();
    return tema;
  }

  async function insertRedacao(userId: string, temaId: string, createdAt: Date) {
    await db.insert(redacoes).values({
      id: crypto.randomUUID(),
      userId,
      temaId,
      text: "Texto de teste.",
      scores: { competencia1: 0, competencia2: 0, competencia3: 0, competencia4: 0, competencia5: 0 },
      notaTotal: 0,
      feedback: { justificativas: ["", "", "", "", ""], comentarioGeral: "" },
      createdAt,
    });
  }

  it("permite a primeira correção do mês no plano grátis", async () => {
    const testUser = await createTestUser();
    expect(await canSubmitRedacao(testUser.id)).toBe(true);
  });

  it("bloqueia a segunda correção do mês no plano grátis", async () => {
    const testUser = await createTestUser();
    const tema = await createTema();
    await insertRedacao(testUser.id, tema.id, new Date());
    expect(await canSubmitRedacao(testUser.id)).toBe(false);
  });

  it("uma redação do mês passado não conta para o limite do mês atual", async () => {
    const testUser = await createTestUser();
    const tema = await createTema();
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    await insertRedacao(testUser.id, tema.id, lastMonth);
    expect(await canSubmitRedacao(testUser.id)).toBe(true);
  });

  it("premium permite até 20 correções no mês", async () => {
    const testUser = await createTestUser();
    await makePremium(testUser.id, 30 * 24 * 60 * 60 * 1000);
    const tema = await createTema();
    for (let i = 0; i < 20; i++) {
      await insertRedacao(testUser.id, tema.id, new Date());
    }
    expect(await canSubmitRedacao(testUser.id)).toBe(false);
  });

  it("premium com 19 correções no mês ainda pode enviar mais uma", async () => {
    const testUser = await createTestUser();
    await makePremium(testUser.id, 30 * 24 * 60 * 60 * 1000);
    const tema = await createTema();
    for (let i = 0; i < 19; i++) {
      await insertRedacao(testUser.id, tema.id, new Date());
    }
    expect(await canSubmitRedacao(testUser.id)).toBe(true);
  });
});
