import { redirect } from "next/navigation"
import { landingFor } from "@/lib/landing"

// Post-authentication dispatch. Every sign-in path (magic link, password, signup)
// lands here, and this resolves where the person actually goes: their intended
// destination if their role can reach it, else their role's home.
//
// A page, not a route handler. redirect() thrown while rendering is understood by
// the client router, so the address bar lands on the destination even on a soft
// navigation. A route handler's 307 was followed inside the router's fetch and the
// bar stayed on /go, so the next server action POSTed to /go and got a 405.
export default async function Go(props: { searchParams: Promise<{ to?: string | string[] }> }) {
  const { to } = await props.searchParams
  const target = await landingFor(to)
  if (target) redirect(target)

  const back = Array.isArray(to) ? to[0] : to
  redirect(back ? `/signin?callbackUrl=${encodeURIComponent(back)}` : "/signin")
}
