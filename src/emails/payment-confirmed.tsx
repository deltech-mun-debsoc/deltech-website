import { formatDateLong } from "@/lib/datetime"
import { EmailShell, P, B, Cta, Panel, Row, Contacts } from "./_shell"

interface Props {
  eventName: string
  fullName: string
  partnerName?: string
  committeeName: string
  portfolioName: string
  amountInr: number
  confirmedAt: Date
  whatsappCommunityUrl: string
  groupUrl?: string
  contactEmail: string
  contacts: Array<{ name: string; role: string; phone: string }>
}

export function PaymentConfirmedEmail({
  eventName,
  fullName,
  partnerName,
  committeeName,
  portfolioName,
  amountInr,
  confirmedAt,
  whatsappCommunityUrl,
  groupUrl,
  contactEmail,
  contacts,
}: Props) {
  return (
    <EmailShell
      preview="Payment received. Your seat is confirmed."
      eyebrow={`${eventName} · Payment confirmed`}
      heading="Your seat is confirmed"
      footer={`${eventName} · Delhi Technological University · Delhi`}
    >
      <P>
        Hi {fullName}, we have your <B>₹{amountInr.toLocaleString("en-IN")}</B>. Your registration
        for {eventName} is complete.
      </P>

      <Panel title="Your allotment" tone="brand">
        <Row label="Committee" value={committeeName} />
        <Row label="Portfolio" value={portfolioName} />
        {partnerName && <Row label="Co-delegate" value={partnerName} />}
        <Row
          label="Confirmed on"
          value={formatDateLong(confirmedAt)}
        />
      </Panel>

      {groupUrl && <Cta href={groupUrl}>Join the {committeeName} WhatsApp group</Cta>}

      <P last={!whatsappCommunityUrl}>
        Schedule, venue, prep material and committee notices all come through the official channels
        from here.
      </P>

      {whatsappCommunityUrl && (
        <Cta href={whatsappCommunityUrl}>Join the official WhatsApp community</Cta>
      )}

      <Contacts contactEmail={contactEmail} contacts={contacts} />
    </EmailShell>
  )
}
