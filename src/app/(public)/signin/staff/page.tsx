import { redirect } from "next/navigation"

// There is one sign-in door. Staff and delegates share the account table and the
// same two methods, and where you land is decided by your role afterwards, so a
// second door only offered a wrong one to pick. This path stays for old invite
// emails and bookmarks.
export default async function StaffSignInRedirect(props: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}) {
  const { callbackUrl, error } = await props.searchParams
  const query = new URLSearchParams()
  if (callbackUrl) query.set("callbackUrl", callbackUrl)
  if (error) query.set("error", error)
  const qs = query.toString()
  redirect(qs ? `/signin?${qs}` : "/signin")
}
