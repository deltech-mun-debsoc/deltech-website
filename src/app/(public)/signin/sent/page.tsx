import Link from "next/link";
import { MailCheck } from "lucide-react";
import { t } from "@/content/strings";
import { AuthStage } from "@/components/auth-stage";

// Reached two ways: Auth.js after sending a link (?provider=resend&type=email),
// and the sign-in action when the address has no account, which uses the same
// query on purpose. A bare visit has sent nothing, so it must not say it has.
export default async function CheckEmailPage(props: {
  searchParams: Promise<{ type?: string }>
}) {
  const { type } = await props.searchParams;
  const sent = type === "email";

  return (
    <AuthStage
      marker={t("auth.signInMarker")}
      headline={sent ? [t("auth.sentHeadline1"), t("auth.sentHeadline2")] : [t("auth.signInHeadline1"), t("auth.signInHeadline2")]}
    >
      {sent ? (
        <>
          <MailCheck className="size-8 text-teal-700" aria-hidden />
          <h2 className="mt-5 font-heading text-4xl leading-tight">{t("auth.checkEmailTitle")}</h2>
          <p className="mt-3 text-base leading-relaxed text-black/65">{t("auth.checkEmailMessage")}</p>
          <ul className="mt-7 space-y-3 border-t border-black/15 pt-5 text-sm leading-relaxed text-black/65">
            <li>{t("auth.checkEmailExpiry")}</li>
            {/* An address with no account lands here too, so that a typo is not
                answered with "Something went wrong" and is not confirmed either.
                That only works if the page admits nothing may be coming. */}
            <li>{t("auth.checkEmailNoAccount")}</li>
            <li>
              {t("auth.checkSpam")}{" "}
              <Link href="/signin" className="font-semibold text-teal-800 underline underline-offset-4">
                {t("auth.requestAnother")}
              </Link>
              .
            </li>
          </ul>
        </>
      ) : (
        <>
          <h2 className="font-heading text-4xl leading-tight">{t("auth.directSentTitle")}</h2>
          <p className="mt-3 text-base leading-relaxed text-black/65">{t("auth.directSentBody")}</p>
          <Link href="/signin" className="mt-7 inline-flex h-11 items-center bg-[#111614] px-5 text-sm font-semibold text-white hover:bg-teal-800">
            {t("auth.goToSignIn")}
          </Link>
        </>
      )}
    </AuthStage>
  );
}
