import Link from "next/link"
import { requireStaff } from "@/lib/authz"
import { getContent } from "@/lib/settings"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { SiteSections } from "./_components/site-sections"
import { TabContent } from "@/app/(admin)/admin/(event)/config/_components/tab-content"

export default async function SitePage() {
  await requireStaff()
  const content = await getContent()
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Website"
        description="The society's own pages. Changes go live as soon as you switch them."
      />
      <p className="max-w-3xl text-sm text-muted-foreground">
        {"The running event's homepage section, committees, matrix and registration follow the event itself, from "}
        <Link href="/admin/config" className="font-medium text-foreground underline underline-offset-2">Event control</Link>.
      </p>
      <SiteSections sections={content.publicSections} />
      <section className="editorial-card p-7">
        <h2 className="font-heading text-2xl">Society copy and contacts</h2>
        <p className="mt-2 text-base text-muted-foreground">
          Who the society is, the awards it gives, and the people who sign delegate emails.
        </p>
        <div className="rule my-5" />
        <TabContent content={content} />
      </section>
    </div>
  )
}
