import { requireUser } from "@/lib/session";
import { getDashboardData } from "@/lib/dashboard";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { vencidos, fracos } = await getDashboardData(session.user.id);
  return Response.json({ vencidos, fracos });
}
