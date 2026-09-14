import { SectionNav } from "@/app/(admin)/_components/section-nav"
import { DELEGATE_SECTIONS } from "../../_lib/event-tabs"

// Shown on each delegate page; they are siblings in the route tree, so there is
// no shared layout to hang it on.
export function DelegateTabs() {
  return <SectionNav sections={DELEGATE_SECTIONS} />
}
