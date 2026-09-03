"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { ThemePreferenceSync } from "@/components/theme/theme-preference-sync";
import { THEME_STORAGE_KEY } from "@/lib/theme";

// The OS preference is the default. A manual choice is mirrored to a cookie so
// server-rendered admin/recruitment shells and public pages share one preference.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey={THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      <ThemePreferenceSync />
      {children}
      <Toaster richColors closeButton position="bottom-right" />
    </ThemeProvider>
  );
}
