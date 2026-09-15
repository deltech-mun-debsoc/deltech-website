import { redirect } from "next/navigation"

// The society's copy moved to the Website page; old links land there.
export default function ConferenceSettingsPage() {
  redirect("/admin/site")
}
