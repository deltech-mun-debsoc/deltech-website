import { EmailShell, P, Cta, Fine } from "./_shell"

interface Props {
  committeeName: string
  signInUrl: string
}

export function ChairInviteEmail({ committeeName, signInUrl }: Props) {
  return (
    <EmailShell
      preview={`You are chairing ${committeeName} at DelTech MUN.`}
      eyebrow="DelTech MUN · Committee dais"
      heading="You're on the dais"
    >
      <P>The secretariat has added you as a chair of {committeeName}.</P>
      <P>
        Sign in with this email address. The first time, use the magic link tab and we will send you
        a one-time link. You can set a password afterwards from your account page. Your committee
        opens when the secretariat starts each session.
      </P>

      <Cta href={signInUrl}>Open sign-in</Cta>

      <Fine>Not expecting this? Let the secretariat know and we will remove the account.</Fine>
    </EmailShell>
  )
}
