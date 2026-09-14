import { getContent } from "@/lib/settings"
import { requireStaff } from "@/lib/authz"
import { TabContent } from "../_components/tab-content"

export default async function ConferenceSettingsPage() {
  await requireStaff()
  const content = await getContent()

  return (
    <div className="editorial-card p-7">
      <h2 className="font-heading text-2xl">Public identity and automated signatories</h2>
      <p className="mt-2 text-base text-muted-foreground">
        Society copy, active-event details, venue, awards, and the people who sign delegate emails.
      </p>
      <div className="rule my-5" />
      <TabContent content={content} />
    </div>
  )
}
