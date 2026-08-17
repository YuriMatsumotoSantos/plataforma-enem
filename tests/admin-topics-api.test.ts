import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user, topics } from "@/db/schema";
import { GET } from "@/app/api/admin/topics/route";

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

describe("GET /api/admin/topics", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/admin/topics");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("retorna a lista de tópicos para um admin", async () => {
    const [topic] = await db
      .insert(topics)
      .values({
        id: crypto.randomUUID(),
        area: "natureza",
        subject: "Física",
        name: `Óptica Teste ${crypto.randomUUID()}`,
      })
      .returning();

    const cookie = await createAdminCookie();
    const request = new Request("http://localhost:3000/api/admin/topics", {
      headers: { cookie },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const found = body.topics.find((t: { id: string }) => t.id === topic.id);
    expect(found).toBeDefined();
    expect(found.subject).toBe("Física");
  });
});
