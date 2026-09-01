import Link from "next/link";
import { t } from "@/content/strings";

export default function CheckEmailPage() {
  return (
    <div className="paper-grid flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <Link href="/" className="display text-3xl text-foreground">
            {t("brand.name")}
          </Link>
        </div>

        <div className="editorial-card p-6 text-center sm:p-8">
          <span aria-hidden className="text-2xl text-gold-500">
            ✉
          </span>
          <h1 className="mt-3 font-heading text-2xl">{t("auth.checkEmailTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("auth.checkEmailMessage")}</p>
          <div className="rule my-5" />
          <p className="text-xs text-muted-foreground">{t("auth.checkEmailExpiry")}</p>
          {/* An address with no account lands here too, so that a typo is not
              answered with "Something went wrong" and is not confirmed either.
              That only works if the page admits nothing may be coming. */}
          <p className="mt-2 text-xs text-muted-foreground">{t("auth.checkEmailNoAccount")}</p>
          <p className="mt-4 text-xs text-muted-foreground">
            Didn’t get it? Check spam, or{" "}
            <Link href="/signin" className="font-medium text-teal-800 underline underline-offset-2">
              request another link
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
