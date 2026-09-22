"use client";

import { useActionState } from "react";
import { t } from "@/content/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signupWithMagicLink } from "../actions";

const ERROR_MESSAGES: Record<string, string> = {
  accountExists: "An account with this email already exists. Sign in instead.",
  nonDelegateAccount: "This email is reserved for an admin or author account.",
  invalidCredentials: "Could not sign in after account creation. Please sign in manually.",
  tooManyRequests: "Too many attempts. Wait a few minutes and try again.",
  errorDefault: "Something went wrong. Please try again.",
};

export function SignupForm() {
  const [mlState, mlAction, mlPending] = useActionState(signupWithMagicLink, null);

  return (
    <form action={mlAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ml-email">{t("auth.emailLabel")}</Label>
        <Input
          id="ml-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder={t("auth.emailPlaceholder")}
          disabled={mlPending}
          className="h-10"
        />
      </div>
      {mlState?.error && (
        <p className="text-sm text-destructive">
          {ERROR_MESSAGES[mlState.error] ?? ERROR_MESSAGES.errorDefault}
        </p>
      )}
      <Button type="submit" disabled={mlPending} className="h-10 w-full">
        {mlPending ? t("common.sending") : t("auth.sendMagicLinkButton")}
      </Button>
      <p className="text-xs text-center text-muted-foreground">
        {t("auth.signUpVerificationNote")}
      </p>
    </form>
  );
}
