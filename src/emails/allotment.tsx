import { Text, Hr, Section, Button } from "@react-email/components"
import {
  EmailShell, P, B, A, Cta, Panel, Row, Callout, Contacts, muted, bodyInk, ink, brand,
} from "./_shell"

interface Props {
  eventName: string
  fullName: string
  committeeName: string
  portfolioName: string
  agenda: string | null
  amountInr?: number
  payLink?: string
  paymentsEnabled: boolean
  needsAccommodation: boolean
  accommodationNote: string
  conferenceDates: string
  venue: string
  paymentDeadline: string
  paymentProofUrl: string
  refundPolicy: string
  contactEmail: string
  contacts: Array<{ name: string; role: string; phone: string }>
  statusUrl?: string
  whatsappCommunityUrl?: string
}

export function AllotmentEmail({
  eventName,
  fullName,
  committeeName,
  portfolioName,
  agenda,
  amountInr,
  payLink,
  paymentsEnabled,
  needsAccommodation,
  accommodationNote,
  conferenceDates,
  venue,
  paymentDeadline,
  paymentProofUrl,
  refundPolicy,
  contactEmail,
  contacts,
  statusUrl,
  whatsappCommunityUrl,
}: Props) {
  const payable = paymentsEnabled && amountInr != null && payLink
  const amount = amountInr != null ? `₹${amountInr.toLocaleString("en-IN")}` : ""

  return (
    <EmailShell
      preview={
        payable
          ? "Your portfolio allotment and payment link are inside."
          : "Your portfolio allotment is confirmed."
      }
      eyebrow={`${eventName} · Portfolio allotment`}
      heading="Your portfolio is confirmed"
      footer={`${eventName} · Delhi Technological University · Delhi`}
    >
      <P>
        Hi {fullName}, the secretariat has allotted you <B>{portfolioName}</B> in{" "}
        <B>{committeeName}</B>.
      </P>

      <Panel title="Your allotment">
        <Row label="Committee" value={committeeName} />
        <Row label="Portfolio" value={portfolioName} />
        {agenda && (
          <>
            <Text style={{ color: muted, fontSize: 11, margin: "0 0 2px" }}>Agenda</Text>
            <Text style={{ color: bodyInk, fontSize: 13, lineHeight: "1.5", margin: 0 }}>
              {agenda}
            </Text>
          </>
        )}
      </Panel>

      {(conferenceDates || venue) && (
        <Section
          style={{
            borderTop: "1px solid #e4e4e7",
            borderBottom: "1px solid #e4e4e7",
            padding: "14px 0",
            margin: "0 0 24px",
          }}
        >
          {conferenceDates && (
            <Text style={{ color: ink, fontSize: 14, margin: "0 0 6px" }}>
              <B>Conference:</B> {conferenceDates}
            </Text>
          )}
          {venue && (
            <Text style={{ color: ink, fontSize: 14, margin: 0 }}>
              <B>Venue:</B> {venue}
            </Text>
          )}
        </Section>
      )}

      {payable ? (
        <>
          <Panel title="Registration fee" tone="brand">
            <Text style={{ color: ink, fontSize: 24, fontWeight: 700, margin: 0 }}>{amount}</Text>
          </Panel>

          <Cta href={payLink}>Pay {amount}</Cta>

          <P>
            The seat is held for you. Pay{" "}
            {paymentDeadline ? (
              <>
                by <B>{paymentDeadline}</B>
              </>
            ) : (
              "before the stated deadline"
            )}{" "}
            to lock it in.
          </P>

          {paymentProofUrl && (
            <Button
              href={paymentProofUrl}
              style={{
                color: brand,
                fontSize: 13,
                fontWeight: 700,
                textDecoration: "underline",
                display: "block",
                margin: "0 0 14px",
              }}
            >
              Submit payment proof after paying
            </Button>
          )}

          {refundPolicy && (
            <Text style={{ color: muted, fontSize: 12, lineHeight: "1.6", margin: 0 }}>
              {refundPolicy}
            </Text>
          )}
        </>
      ) : (
        <Callout>Nothing to pay. Your allotment is confirmed as it stands.</Callout>
      )}

      {statusUrl && (
        <>
          <Hr style={{ borderColor: "#e4e4e7", margin: "24px 0" }} />
          <P>
            Everything about your place is on <A href={statusUrl}>your delegate page</A>:
            your committee and portfolio, what is left to pay if anything, and the
            check-in code the desk scans on the day. Keep the link; it stays current.
          </P>
          <Section style={{ margin: "16px 0 0" }}>
            <Button
              href={statusUrl}
              style={{
                backgroundColor: brand,
                borderRadius: 4,
                color: "#ffffff",
                display: "inline-block",
                fontSize: 13,
                fontWeight: 600,
                padding: "10px 18px",
                textDecoration: "none",
              }}
            >
              Open my delegate page
            </Button>
          </Section>
        </>
      )}

      {whatsappCommunityUrl && (
        <P>
          Announcements and last-minute changes go out on{" "}
          <A href={whatsappCommunityUrl}>the delegates group</A>. Please join it.
        </P>
      )}

      {needsAccommodation && accommodationNote && (
        <>
          <Hr style={{ borderColor: "#e4e4e7", margin: "24px 0" }} />
          <Text
            style={{
              color: muted,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              margin: "0 0 8px",
            }}
          >
            Accommodation
          </Text>
          <Text style={{ color: bodyInk, fontSize: 13, lineHeight: "1.6", margin: 0 }}>
            {accommodationNote}
          </Text>
        </>
      )}

      <Contacts contactEmail={contactEmail} contacts={contacts} />
    </EmailShell>
  )
}
