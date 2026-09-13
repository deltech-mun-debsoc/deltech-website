import { Fragment } from "react"
import { EmailShell, P, A, Cta, Fine } from "./_shell"

interface Props {
  eventName: string
  subject: string
  paragraphs: string[]
  ctaLabel?: string
  ctaUrl?: string
  contactEmail: string
  // Why this person is getting it. Delegates registered; outreach contacts asked
  // to hear about events. Saying which is part of not reading as spam.
  reason: string
  unsubscribeUrl?: string
}

// The body of every mail sent from the admin mailer. The text is whatever the
// secretariat wrote, already merged for this recipient; this only lays it out.
export function MailerEmail({
  eventName,
  subject,
  paragraphs,
  ctaLabel,
  ctaUrl,
  contactEmail,
  reason,
  unsubscribeUrl,
}: Props) {
  return (
    <EmailShell preview={paragraphs[0]?.slice(0, 140) ?? subject} eyebrow={eventName} heading={subject}>
      {paragraphs.map((para, i) => (
        <P key={i} last={i === paragraphs.length - 1 && !ctaUrl}>
          {para.split("\n").map((line, j, lines) => (
            <Fragment key={j}>
              {line}
              {j < lines.length - 1 && <br />}
            </Fragment>
          ))}
        </P>
      ))}
      {ctaLabel && ctaUrl && <Cta href={ctaUrl}>{ctaLabel}</Cta>}
      <Fine>
        {reason} Questions go to <A href={`mailto:${contactEmail}`}>{contactEmail}</A>.
        {unsubscribeUrl && (
          <>
            {" "}
            <A href={unsubscribeUrl}>Unsubscribe</A>
          </>
        )}
      </Fine>
    </EmailShell>
  )
}
