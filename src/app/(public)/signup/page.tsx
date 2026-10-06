import { redirect } from "next/navigation";
import Link from "next/link";
import { landingFor } from "@/lib/landing";
import { t } from "@/content/strings";
import { AuthStage } from "@/components/auth-stage";
import { SignupForm } from "./_components/signup-form";

export default async function SignupPage() {
  // Signed in already: send them to their role's home, decided in the one place
  // /go and the sign-in doors also use. A hardcoded /dashboard used to bounce a
  // signed-in admin or author around.
  const target = await landingFor(null);
  if (target) redirect(target);

  return (
    <AuthStage marker={t("auth.signUpMarker")} headline={[t("auth.signUpHeadline1"), t("auth.signUpHeadline2")]} intro={t("auth.delegateIntro")}>
      <h2 className="font-heading text-4xl leading-tight">{t("auth.signUpTitle")}</h2>
      <p className="mt-3 text-base leading-relaxed text-black/65">{t("auth.signUpDescription")}</p>
      <div className="mt-7">
        <SignupForm />
      </div>
      <p className="mt-7 border-t border-black/15 pt-5 text-sm text-black/65">
        {t("auth.alreadyHaveAccount")}{" "}
        <Link href="/signin" className="font-semibold text-teal-800 underline underline-offset-4">
          {t("auth.signInLinkText")}
        </Link>
      </p>
    </AuthStage>
  );
}
