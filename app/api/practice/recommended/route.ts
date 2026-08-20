import { requireUser } from "@/lib/session";
import { getRecommendedSession } from "@/lib/recommended-session";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { questions } = await getRecommendedSession(session.user.id);
  return Response.json({ questions });
}
