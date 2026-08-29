"use client"

import { useEffect, useState } from "react"

// Popups (Select, Dialog, DropdownMenu) portal to document.body, which sits
// OUTSIDE the area shell that carries the theme class. Because the dark variant
// is scope-aware (`.dark` unless inside `.theme-light`, see globals.css), a
// portalled popup reads the theme of <html> rather than the area it belongs to:
// a dark recruitment console gets a light dropdown, and vice versa.
//
// Portalling into the shell instead keeps the popup inside the same theme scope.
//
// ponytail: one shell is mounted at a time (the route groups are mutually
// exclusive), so a single querySelector is enough. If two themed shells ever
// render together, pass the container down through context instead.
const SHELL_SELECTOR = ".recruitment-shell, .admin-shell"

export function useThemedPortalContainer(): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null)

  // After mount: the shell is server-rendered, so it exists by the time any
  // popup can be opened. Falls back to null, which Base UI reads as document.body.
  useEffect(() => {
    setContainer(document.querySelector<HTMLElement>(SHELL_SELECTOR))
  }, [])

  return container
}
