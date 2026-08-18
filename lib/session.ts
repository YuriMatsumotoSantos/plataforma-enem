import { auth } from "@/lib/auth";

export async function requireUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return null;
  }

  return { user: { id: session.user.id, email: session.user.email } };
}
