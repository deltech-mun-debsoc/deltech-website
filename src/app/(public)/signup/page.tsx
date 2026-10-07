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
    <AuthStage>
      <h1 className="text-2xl font-semibold">{t("auth.signUpTitle")}</h1>
      <p className="mt-2 text-base text-muted-foreground">{t("auth.signUpDescription")}</p>
      <div className="mt-6">
        <SignupForm />
      </div>
      <p className="mt-8 border-t border-border pt-5 text-sm text-muted-foreground">
        {t("auth.alreadyHaveAccount")}{" "}
        <Link href="/signin" className="font-semibold text-foreground underline underline-offset-4">
          {t("auth.signInLinkText")}
        </Link>
      </p>
    </AuthStage>
  );
}
