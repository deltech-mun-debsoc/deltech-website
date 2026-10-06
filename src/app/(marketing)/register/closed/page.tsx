import Link from "next/link";
import { redirect } from "next/navigation";
import { getContent } from "@/lib/settings";
import { t } from "@/content/strings";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deriveEventState } from "@/lib/event-state";

export default async function RegistrationClosedPage() {
  const content = await getContent();

  if (deriveEventState(content).acceptsRegistrations) redirect("/register");

  return (
    <div className="section-shell max-w-2xl py-16 sm:py-24">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("marketing.registrationClosedTitle")}</h1>
        <p className="body-large mt-4 text-muted-foreground">{content.registrationClosedMessage}</p>
        <Link href="/" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "mt-8")}>
          {t("nav.home")}
        </Link>
      </div>
    </div>
  );
}
