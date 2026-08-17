import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user, topics, questions } from "@/db/schema";
import { GET } from "@/app/api/admin/questions/route";
import { PATCH } from "@/app/api/admin/questions/[id]/route";

// Anos fora da faixa real do ENEM, para não colidir com dados reais
// (ex.: as 179 questões de 2025 já presentes no banco de dev local).
function randomTestYear(): number {
  return 90000 + (Date.now() % 9000);
}

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

  it("retorna as questões de um status para um admin, com o topic", async () => {
    // Usa status=rejeitada (não pendente) porque o banco de dev compartilhado
    // já tem 200+ questões reais com status=pendente sem ORDER BY definido:
    // com paginação, a questão recém-inserida não teria garantia de cair na
    // primeira página. status=rejeitada está garantidamente livre de dados reais.
    // Também filtra por area=natureza para não competir com o teste de
    // paginação abaixo, que insere 25 linhas rejeitada/matematica a cada run.
    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "natureza", subject: "Física", name: "Óptica" })
      .returning();

    const testYear = randomTestYear();
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
      status: "rejeitada",
    });

    const cookie = await createAdminCookie();
    const request = new Request(
      "http://localhost:3000/api/admin/questions?status=rejeitada&area=natureza",
      { headers: { cookie } }
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const found = body.questions.find((q: { year: number }) => q.year === testYear);
    expect(found).toBeDefined();
    expect(found.topic.name).toBe("Óptica");
  });

  it("retorna 400 para área inválida na query", async () => {
    const cookie = await createAdminCookie();
    const request = new Request(
      "http://localhost:3000/api/admin/questions?area=xyz",
      { headers: { cookie } }
    );
    const response = await GET(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Área inválida");
  });

  it("usa page=1 quando o parâmetro page é inválido ou ausente", async () => {
    const cookie = await createAdminCookie();

    const noPageRequest = new Request(
      "http://localhost:3000/api/admin/questions?status=rejeitada",
      { headers: { cookie } }
    );
    const noPageBody = await (await GET(noPageRequest)).json();
    expect(noPageBody.page).toBe(1);
    expect(noPageBody.pageSize).toBe(20);

    const invalidPageRequest = new Request(
      "http://localhost:3000/api/admin/questions?status=rejeitada&page=abc",
      { headers: { cookie } }
    );
    const invalidPageBody = await (await GET(invalidPageRequest)).json();
    expect(invalidPageBody.page).toBe(1);

    const zeroPageRequest = new Request(
      "http://localhost:3000/api/admin/questions?status=rejeitada&page=0",
      { headers: { cookie } }
    );
    const zeroPageBody = await (await GET(zeroPageRequest)).json();
    expect(zeroPageBody.page).toBe(1);
  });

  it("pagina os resultados, 20 por página, com total refletindo o total real", async () => {
    const cookie = await createAdminCookie();

    // Baseline dinâmico: não assume que status=rejeitada está vazio no banco
    // compartilhado (outros testes do suite podem já ter inserido linhas ali).
    const baselineRequest = new Request(
      "http://localhost:3000/api/admin/questions?status=rejeitada",
      { headers: { cookie } }
    );
    const baselineBody = await (await GET(baselineRequest)).json();
    const baselineTotal: number = baselineBody.total;

    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "matematica", subject: "Matemática", name: "Álgebra" })
      .returning();

    const testYear = randomTestYear();
    const baseNumber = Math.floor(Math.random() * 500) + 1;

    for (let i = 0; i < 25; i++) {
      await db.insert(questions).values({
        id: crypto.randomUUID(),
        year: testYear,
        examDay: 1,
        questionNumber: baseNumber + i,
        area: "matematica",
        statement: `questão paginação ${i}`,
        alternatives: [
          { letter: "A", text: "1" },
          { letter: "B", text: "2" },
          { letter: "C", text: "3" },
          { letter: "D", text: "4" },
          { letter: "E", text: "5" },
        ],
        correctAnswer: "A",
        topicId: topic.id,
        status: "rejeitada",
      });
    }

    const expectedTotal = baselineTotal + 25;

    const firstPageRequest = new Request(
      "http://localhost:3000/api/admin/questions?status=rejeitada",
      { headers: { cookie } }
    );
    const firstPage = await (await GET(firstPageRequest)).json();
    expect(firstPage.total).toBe(expectedTotal);
    expect(firstPage.page).toBe(1);
    expect(firstPage.pageSize).toBe(20);
    expect(firstPage.questions).toHaveLength(20);

    const lastPageNumber = Math.ceil(expectedTotal / 20);
    const lastPageRequest = new Request(
      `http://localhost:3000/api/admin/questions?status=rejeitada&page=${lastPageNumber}`,
      { headers: { cookie } }
    );
    const lastPage = await (await GET(lastPageRequest)).json();
    const expectedLastPageCount = expectedTotal - (lastPageNumber - 1) * 20;
    expect(lastPage.questions).toHaveLength(expectedLastPageCount);

    if (lastPageNumber !== 1) {
      const firstIds = new Set(firstPage.questions.map((q: { id: string }) => q.id));
      const overlap = lastPage.questions.filter((q: { id: string }) => firstIds.has(q.id));
      expect(overlap).toHaveLength(0);
    }
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

    const testYear = randomTestYear();
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

    const testYear = randomTestYear();
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

  it("retorna 400 quando alternatives não tem exatamente 5 itens (A-E)", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "linguagens", subject: "Português", name: "Interpretação" })
      .returning();

    const testYear = randomTestYear();
    const testDay = Math.floor(Math.random() * 2) + 1;
    const testNumber = Math.floor(Math.random() * 100) + 1;

    const [question] = await db
      .insert(questions)
      .values({
        id: crypto.randomUUID(),
        year: testYear,
        examDay: testDay,
        questionNumber: testNumber,
        area: "linguagens",
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
        body: JSON.stringify({
          alternatives: [
            { letter: "A", text: "1" },
            { letter: "B", text: "2" },
            { letter: "C", text: "3" },
            { letter: "D", text: "4" },
          ],
        }),
      }
    );
    const response = await PATCH(request, { params: Promise.resolve({ id: question.id }) });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Alternativas devem ter exatamente 5 itens (A-E)");
  });

  it("retorna 400 para statement null no PATCH", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "humanas", subject: "História", name: "Brasil Colonial" })
      .returning();

    const testYear = randomTestYear();
    const testDay = Math.floor(Math.random() * 2) + 1;
    const testNumber = Math.floor(Math.random() * 100) + 1;

    const [question] = await db
      .insert(questions)
      .values({
        id: crypto.randomUUID(),
        year: testYear,
        examDay: testDay,
        questionNumber: testNumber,
        area: "humanas",
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
        body: JSON.stringify({ statement: null }),
      }
    );
    const response = await PATCH(request, { params: Promise.resolve({ id: question.id }) });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Campo inválido: statement e correctAnswer devem ser texto");
  });

  it("retorna 400 para correctAnswer null no PATCH", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "natureza", subject: "Biologia", name: "Genética" })
      .returning();

    const testYear = randomTestYear();
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
        body: JSON.stringify({ correctAnswer: null }),
      }
    );
    const response = await PATCH(request, { params: Promise.resolve({ id: question.id }) });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Campo inválido: statement e correctAnswer devem ser texto");
  });
});
