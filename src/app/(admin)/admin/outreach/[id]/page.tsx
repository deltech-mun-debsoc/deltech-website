import { CampaignView } from "@/app/(admin)/admin/(event)/mailer/_components/campaign-view"

export default async function OutreachCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CampaignView id={id} audience="CONTACTS" />
}
