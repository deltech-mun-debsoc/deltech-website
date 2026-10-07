import { SectionNav } from "@/app/(admin)/_components/section-nav"
import { getEventCapabilities } from "@/lib/event"
import { DELEGATE_SECTIONS } from "../../_lib/event-tabs"

// Shown on each delegate page; they are siblings in the route tree, so there is
// no shared layout to hang it on. A way in that this event does not offer is not
// shown at all, rather than shown and refused at the end.
export async function DelegateTabs() {
  const caps = await getEventCapabilities()
  return <SectionNav sections={DELEGATE_SECTIONS.filter((s) => s.href !== "/admin/import" || caps.crossDelegations)} />
}
