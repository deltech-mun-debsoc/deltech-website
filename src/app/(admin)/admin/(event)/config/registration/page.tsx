import { redirect } from "next/navigation"

// The registration switch and the closed message are part of Event control now.
export default function RegistrationSettingsPage() {
  redirect("/admin/config")
}
