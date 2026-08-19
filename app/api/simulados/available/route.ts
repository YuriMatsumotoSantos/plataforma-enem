import { requireUser } from "@/lib/session";
import { getFielAvailability, getMescladoAvailability } from "@/lib/simulados";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const [fiel, mesclado] = await Promise.all([getFielAvailability(), getMescladoAvailability()]);
  return Response.json({ fiel, mesclado });
}
