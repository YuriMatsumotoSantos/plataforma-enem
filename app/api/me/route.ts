import { auth } from "@/lib/auth";
import { getUserPlan } from "@/lib/entitlements";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const plan = await getUserPlan(session.user.id);

  return Response.json({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    plan,
  });
}
