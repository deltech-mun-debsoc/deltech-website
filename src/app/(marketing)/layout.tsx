import { getContent } from "@/lib/settings";
import { Header } from "./_components/header";
import { Footer } from "./_components/footer";
import { deriveEventState } from "@/lib/event-state";

export const dynamic = "force-dynamic";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const content = await getContent();
  const eventState = deriveEventState(content);
  return (
    <div className="flex min-h-svh flex-col">
      <Header sections={content.publicSections} registrationOpen={eventState.acceptsRegistrations} />
      <main className="flex-1">{children}</main>
      <Footer
        contacts={content.queryContacts}
        conferenceDates={content.conferenceDates}
        venue={content.venue}
        societyLocation={content.societyLocation}
        societyEmail={content.societyEmail}
        sections={content.publicSections}
        activeEventName={content.activeEventName}
        registrationOpen={eventState.acceptsRegistrations}
        showActiveEvent={eventState.showEventHero}
      />
    </div>
  );
}
