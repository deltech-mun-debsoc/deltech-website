import Link from "next/link";
import { t } from "@/content/strings";
import { buttonVariants } from "@/components/ui/button";
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
    <AuthStage>
      {sent ? (
        <>
          <h1 className="text-2xl font-semibold">{t("auth.checkEmailTitle")}</h1>
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">{t("auth.checkEmailMessage")}</p>
          <Link href="/signin" className={buttonVariants({ variant: "outline", className: "mt-6 h-11 w-full border-foreground/25 text-base" })}>
            {t("auth.requestAnother")}
          </Link>
          {/* An address with no account lands here too, so that a typo is not
              answered with "Something went wrong" and is not confirmed either.
              That only works if the page admits nothing may be coming. */}
          <details className="mt-6 border-t border-border pt-4 text-sm text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">{t("auth.didNotArrive")}</summary>
            <p className="mt-2 leading-relaxed">{t("auth.checkEmailNoAccount")}</p>
          </details>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{t("auth.directSentTitle")}</h1>
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">{t("auth.directSentBody")}</p>
          <Link href="/signin" className={buttonVariants({ className: "mt-6 h-11 w-full text-base" })}>
            {t("auth.goToSignIn")}
          </Link>
        </>
      )}
    </AuthStage>
  );
}
