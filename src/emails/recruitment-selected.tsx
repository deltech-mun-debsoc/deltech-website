import { EmailShell, P, B, Cta, Callout, Fine, Contacts } from "./_shell"

interface Props {
  fullName: string
  cycleName: string
  societyRole: string | null
  // Empty until the secretariat has a group to invite people to. The email is
  // deliberately sendable before then: the result should not wait on a link.
  whatsappUrl: string
  note: string
  contactEmail?: string | null
  contacts?: { role: string; name: string; phone: string }[]
}

export function RecruitmentSelectedEmail({
  fullName,
  cycleName,
  societyRole,
  whatsappUrl,
  note,
  contactEmail,
  contacts,
}: Props) {
  return (
    <EmailShell
      preview="You have been selected for DelTech MUN."
      eyebrow="DelTech MUN · Recruitment"
      heading="You're in"
    >
      <P>Hi {fullName},</P>
      <P>
        You have been selected through <B>{cycleName}</B>, and you are now part of DelTech MUN.
        Thank you for the time you put into the group discussion and the interview.
      </P>

      {note ? <Callout>{note}</Callout> : null}

      {whatsappUrl ? (
        <>
          <P>
            Everything from here happens in the members&apos; group. Join it now so you do not
            miss the first meeting.
          </P>
          <Cta href={whatsappUrl}>Join the WhatsApp group</Cta>
        </>
      ) : (
        <P>
          The link to the members&apos; group follows in a separate message shortly. Nothing is
          needed from you until then.
        </P>
      )}

      {societyRole ? <Fine>You have been added as: {societyRole}.</Fine> : null}

      {contactEmail ? <Contacts contactEmail={contactEmail} contacts={contacts ?? []} /> : null}
    </EmailShell>
  )
}
