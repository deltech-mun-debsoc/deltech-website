"use client"

import { useActionState } from "react"
import { ArrowRight } from "lucide-react"
import { t } from "@/content/strings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { startWriting, type StartWritingState } from "../actions"

const ERRORS: Record<NonNullable<NonNullable<StartWritingState>["error"]>, string> = {
  name: t("blog.write.errorName"),
  email: t("blog.write.errorEmail"),
  rate: t("blog.write.errorRate"),
  default: t("blog.write.errorDefault"),
}

export function StartWritingForm() {
  const [state, action, pending] = useActionState(startWriting, null)
  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="writer-name">{t("blog.write.nameLabel")}</Label>
        <Input
          id="writer-name"
          name="name"
          autoComplete="name"
          required
          maxLength={80}
          placeholder={t("blog.write.namePlaceholder")}
          disabled={pending}
          className="h-11"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="writer-email">{t("blog.write.emailLabel")}</Label>
        <Input
          id="writer-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder={t("blog.write.emailPlaceholder")}
          disabled={pending}
          className="h-11"
        />
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {ERRORS[state.error]}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending} className="h-11 w-full gap-2">
        {pending ? t("blog.write.sending") : t("blog.write.submit")}
        {!pending && <ArrowRight className="size-4" aria-hidden />}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t("blog.write.formNote")}</p>
    </form>
  )
}
