import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { roleHome } from "@/lib/nav";

// Proxy guards /dashboard/* by role. This layout adds a server-side double-check
// and sends any non-delegate to their own home instead of a dead-end.
export default async function RegistererLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!session) redirect("/signin");
  if (role !== "REGISTERER") redirect(roleHome(role));

  return <div className="app-shell">{children}</div>;
}
