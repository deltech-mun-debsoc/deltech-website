"use client"

import { useActionState } from "react"
import { t } from "@/content/strings"
import { Button } from "@/components/ui/button"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { PASSWORD_MIN } from "@/lib/schemas/password"
import { setOwnPassword } from "../actions"

// Error codes the action can return, mapped to copy here so the server never
// has to know how the client phrases them.
const ERRORS: Record<string, string> = {
  passwordTooShort: "auth.passwordTooShort",
  passwordTooLong: "auth.passwordTooLong",
  passwordMismatch: "auth.passwordMismatch",
  currentPasswordRequired: "account.currentPasswordRequired",
  currentPasswordWrong: "account.currentPasswordWrong",
  notSignedIn: "account.notSignedIn",
}

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, action, pending] = useActionState(setOwnPassword, null)

  return (
    <form action={action} className="flex flex-col gap-4">
      {hasPassword && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="currentPassword">{t("account.currentPasswordLabel")}</Label>
          <PasswordInput
            id="currentPassword"
            name="currentPassword"
            autoComplete="current-password"
            required
            disabled={pending}
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("account.newPasswordLabel")}</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
          disabled={pending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmPassword">{t("auth.confirmPasswordLabel")}</Label>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
          disabled={pending}
        />
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {t((ERRORS[state.error] ?? "auth.errorDefault") as Parameters<typeof t>[0])}
        </p>
      )}
      {state?.success && (
        <p role="status" className="text-sm font-medium text-primary">{t("account.passwordSaved")}</p>
      )}

      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? t("common.loading") : t("account.savePasswordButton")}
      </Button>
    </form>
  )
}
