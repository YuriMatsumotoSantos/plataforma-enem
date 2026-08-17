import { auth } from "@/lib/auth";

export async function requireAdmin(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return null;
  }

  const role = (session.user as { role?: string }).role;
  if (role !== "admin") {
    return null;
  }

  return { user: { id: session.user.id, email: session.user.email, role } };
}
