// The presenter is a projected surface, not a dashboard page.
//
// Without this it inherited the admin shell: the sidebar, the breadcrumb and the
// account header all rendered behind and around the slide, on a screen pointed at
// a room. `fixed inset-0` takes the whole viewport back and covers the shell
// entirely, and a high z-index keeps it above the sticky admin chrome.
//
// No `overflow-hidden` here: the screens animate in and out with framer-motion
// under `AnimatePresence mode="wait"`, and clipping the exiting screen could
// leave its exit transition unresolved, which blocks the next screen mounting.
// Each screen manages its own scrolling.
//
// The route stays inside (admin) deliberately, so requireStaff and the admin
// auth gate still apply: this is a presentation layer, not a permission change.
export default function PresentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-slot="present-root"
      className="fixed inset-0 z-50 bg-black"
    >
      {children}
    </div>
  )
}
