import { requireStaff } from "@/lib/authz"
import { SettingsNav } from "./_components/settings-nav"

// The event header and tab bar above come from the event workspace layout.
export default async function ConfigLayout({ children }: { children: React.ReactNode }) {
  await requireStaff()

  return (
    <div className="flex flex-col gap-8 lg:flex-row">
      <SettingsNav />
      <div className="min-w-0 max-w-6xl flex-1">{children}</div>
    </div>
  )
}
