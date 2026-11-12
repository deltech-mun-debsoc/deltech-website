import Link from "next/link";
import { redirect } from "next/navigation";
import { getContent } from "@/lib/settings";
import { t } from "@/content/strings";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deriveEventState } from "@/lib/event-state";

// The schema's old default said nothing the heading does not. Rows saved before
// the default changed still hold it, so it is treated as no message.
const OLD_DEFAULT = "Registrations are currently closed. Check back soon.";

export default async function RegistrationClosedPage() {
  const content = await getContent();
  const state = deriveEventState(content);

  if (state.acceptsRegistrations) redirect("/register");

  const message = content.registrationClosedMessage.trim();
  const name = state.showEventHero ? content.activeEventName : "";

  return (
    <div className="section-shell max-w-2xl py-16 sm:py-24">
      <h1 className="text-3xl font-semibold">
        {name ? t("marketing.registrationClosedFor", { name }) : t("marketing.registrationClosedTitle")}
      </h1>
      {message && message !== OLD_DEFAULT && <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{message}</p>}
      {content.publicSections.matrix && (
        <Link href="/availability" className={cn(buttonVariants({ size: "lg" }), "mt-8")}>
          {t("marketing.seeCommittees")}
        </Link>
      )}
      <p className="mt-8 text-base text-muted-foreground">
        {t("marketing.questionsWriteTo")}{" "}
        <a href={`mailto:${content.secretariatEmail}`} className="font-medium text-foreground underline underline-offset-4">{content.secretariatEmail}</a>
      </p>
    </div>
  );
}
