"use client"

import { createContext, useContext, useEffect, useState } from "react"

// Popups (Select, Dialog, DropdownMenu) portal out of the React tree. By default
// they land on document.body, which sits OUTSIDE the area shell that carries the
// theme class. Because the dark variant is scope-aware (`.dark` unless inside
// `.theme-light`, see globals.css), a portalled popup then reads the theme of
// <html> rather than the area it belongs to: a dark recruitment console drew a
// light dropdown, and vice versa. Measured: the same `bg-popover` node resolves
// to L=98.6 on body and L=7.2 inside a `.dark` shell.
//
// The target is a dedicated empty node rendered INSIDE each themed shell, never
// the shell element itself. The shell is a layout container (`.admin-shell` is
// `height: 100svh; overflow: hidden`) and Base UI's positioner defaults to
// `collisionBoundary: "clipping-ancestors"`, so portalling into the shell would
// clip every popup at the viewport edge. The mount node has no size and no
// overflow, so it carries the theme without constraining anything.
export const THEME_PORTAL_ID = "themed-popup-root"

// True once we are already inside a portalled popup. A Select inside a Dialog must
// NOT be re-portalled to the shell: Base UI nests a child popup inside its parent's
// portal node so the parent's focus and inert handling treats it as inside.
// Overriding that made every Select and DropdownMenu inside a Dialog misbehave.
const InPopupContext = createContext(false)

export function InPopup({ children }: { children: React.ReactNode }) {
  return <InPopupContext.Provider value={true}>{children}</InPopupContext.Provider>
}

/**
 * The node a popup should portal into, or null to let Base UI decide (parent
 * portal when nested, document.body otherwise).
 */
export function useThemedPortalContainer(): HTMLElement | null {
  const nested = useContext(InPopupContext)
  const [container, setContainer] = useState<HTMLElement | null>(null)

  // Resolved after mount: the node is server-rendered by the area layout, so it
  // exists before any popup can open. Re-read on every mount rather than cached
  // per module, so moving between the admin and recruitment shells picks up the
  // live node instead of pointing at a detached one.
  useEffect(() => {
    if (nested) return
    setContainer(document.getElementById(THEME_PORTAL_ID))
  }, [nested])

  return nested ? null : container
}
