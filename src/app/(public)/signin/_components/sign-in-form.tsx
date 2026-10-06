"use client";

import { useActionState, useEffect, useState } from "react";
import { t } from "@/content/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { requestMagicLink, signInWithPassword } from "../actions";

export function SignInForm({
  defaultTab = "magic",
  callbackUrl = "",
}: {
  defaultTab?: "magic" | "password"
  callbackUrl?: string
}) {
  const [mlState, mlAction, mlPending] = useActionState(requestMagicLink, null);
  const [pwState, pwAction, pwPending] = useActionState(signInWithPassword, null);
  const pwRedirect = pwState?.redirectTo;
  useEffect(() => {
    if (pwRedirect) window.location.assign(pwRedirect);
  }, [pwRedirect]);
  // Controlled so "Forgot password?" can hand the user to the magic-link tab.
  // That link is the whole password-recovery flow: the magic link is already a
  // single-use expiring token, so there is no separate reset token to mint.
  const [tab, setTab] = useState<string>(defaultTab);
  // ...but landing them on their role home would leave them exactly where they
  // started, still without a password. When recovery is what brought them here,
  // send them to /account, which is where the password form lives.
  const [recovering, setRecovering] = useState(false);
  const magicCallbackUrl = recovering ? "/account" : callbackUrl;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="gap-6">
      {/* The base TabsList pins its height with group-data-horizontal/tabs:h-8,
          which a plain h-* cannot override, so the track stayed 32px while the
          triggers were 44px. Override the same variant so track and triggers
          share one height. */}
      <TabsList className="grid w-full grid-cols-2 rounded-lg bg-muted p-1 group-data-horizontal/tabs:h-12">
        <TabsTrigger value="magic" className="h-full rounded-md text-sm font-semibold data-active:shadow-sm">
          {t("auth.magicLinkTab")}
        </TabsTrigger>
        <TabsTrigger value="password" className="h-full rounded-md text-sm font-semibold data-active:shadow-sm">
          {t("auth.passwordTab")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="magic">
        <form action={mlAction} className="flex flex-col gap-5">
          <input type="hidden" name="callbackUrl" value={magicCallbackUrl} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="ml-email">{t("auth.emailLabel")}</Label>
            <Input
              id="ml-email"
              name="email"
              defaultValue={mlState?.email}
              type="email"
              autoComplete="email"
              required
              placeholder={t("auth.emailPlaceholder")}
              disabled={mlPending}
             
            />
          </div>
          {mlState?.error && (
            <p role="alert" className="text-sm text-destructive">
              {mlState.error === "tooManyRequests"
                ? t("auth.tooManyRequests")
                : mlState.error === "errorRetry"
                  ? t("auth.errorRetry")
                  : t("auth.errorDefault")}
            </p>
          )}
          {recovering && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("auth.recoveryHint")}
            </p>
          )}
          <Button type="submit" disabled={mlPending} className="h-11 w-full text-base">
            {mlPending ? t("common.sending") : t("auth.sendLinkButton")}
          </Button>
        </form>
      </TabsContent>

      <TabsContent value="password">
        <form action={pwAction} className="flex flex-col gap-5">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="pw-email">{t("auth.emailLabel")}</Label>
            <Input
              id="pw-email"
              name="email"
              defaultValue={pwState?.email}
              type="email"
              autoComplete="email"
              required
              placeholder={t("auth.emailPlaceholder")}
              disabled={pwPending || !!pwRedirect}
             
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pw-password">{t("auth.passwordLabel")}</Label>
            <PasswordInput
              id="pw-password"
              name="password"
              autoComplete="current-password"
              required
              placeholder={t("auth.passwordPlaceholder")}
              disabled={pwPending || !!pwRedirect}
             
            />
          </div>
          {pwState?.error && (
            <p role="alert" className="text-sm text-destructive">
              {pwState.error === "invalidCredentials"
                ? t("auth.invalidCredentials")
                : pwState.error === "tooManyRequests"
                  ? t("auth.tooManyRequests")
                  : pwState.error === "errorRetry"
                    ? t("auth.errorRetry")
                    : t("auth.errorDefault")}
            </p>
          )}
          <Button type="submit" disabled={pwPending || !!pwRedirect} className="h-11 w-full text-base">
            {pwPending || pwRedirect ? t("common.loading") : t("auth.signInWithPasswordButton")}
          </Button>

          <button
            type="button"
            onClick={() => {
              setRecovering(true);
              setTab("magic");
            }}
            className="self-start rounded-sm text-sm font-semibold text-primary underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t("auth.forgotPassword")}
          </button>

          {/* Invited staff have no passwordHash at all, so the generic
              "invalid email or password" is actively misleading for them.
              Stated up front rather than as an error, which would leak
              whether a given address has an account. */}
          <p className="text-sm leading-relaxed text-muted-foreground">{t("auth.noPasswordYetHint")}</p>
        </form>
      </TabsContent>
    </Tabs>
  );
}
