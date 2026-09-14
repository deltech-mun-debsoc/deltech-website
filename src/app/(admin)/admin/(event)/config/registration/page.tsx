import { getContent } from "@/lib/settings"
import { requireStaff } from "@/lib/authz"
import { TabRegistration } from "../_components/tab-registration"
import { ClosedMessageForm } from "../_components/closed-message-form"

export default async function RegistrationSettingsPage() {
  await requireStaff()
  const content = await getContent()

  return (
    <div className="space-y-6">
      <div className="editorial-card p-6">
        <h2 className="font-heading text-lg">Registration status</h2>
        <div className="rule my-5" />
        <TabRegistration registrationOpen={content.registrationOpen} />
      </div>

      <div className="editorial-card p-6">
        <h2 className="font-heading text-lg">Closed message</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Shown on /register while registration is closed.
        </p>
        <div className="rule my-5" />
        <ClosedMessageForm value={content.registrationClosedMessage} />
      </div>
    </div>
  )
}
