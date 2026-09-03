"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/content/strings";
import { persistThemePreference } from "@/components/theme/theme-preference-sync";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("common.toggleTheme")}
      title={t("common.toggleTheme")}
      onClick={() => {
        const next = resolvedTheme === "dark" ? "light" : "dark";
        persistThemePreference(next);
        setTheme(next);
      }}
    >
      <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  );
}
