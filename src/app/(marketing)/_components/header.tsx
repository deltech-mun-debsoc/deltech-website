"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DOCS_URL } from "@/lib/app-url";
import { t } from "@/content/strings";
import { ThemeToggle } from "./theme-toggle";
import { BrandMark } from "@/components/brand-logo";
import type { Content } from "@/content/contentSchema";

export function Header({ sections, registrationOpen }: { sections: Content["publicSections"]; registrationOpen: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navLinks = [
    { href: "/", label: t("nav.home"), visible: true },
    { href: "/availability", label: t("nav.availability"), visible: sections.matrix },
    { href: "/team", label: t("marketing.teamLabel"), visible: sections.team },
    { href: "/blog", label: t("nav.blog"), visible: sections.dispatch },
    { href: "/quiz/join", label: t("nav.quizJoin"), visible: sections.quiz },
  ].filter((item) => item.visible);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
    <header className="sticky top-0 z-50 w-full border-b border-border/70 bg-background/90 backdrop-blur-xl">
      <div className="section-shell flex h-16 items-center justify-between gap-5">
        <Link href="/" className="flex items-center gap-2.5 text-foreground">
          <BrandMark />
          <span className="text-lg font-semibold">{t("brand.name")}</span>
        </Link>

        <nav aria-label={t("nav.home")} className="hidden items-center gap-7 lg:flex">
          {navLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={cn(
                "border-b-2 pb-1 text-[0.9375rem] font-semibold transition-colors",
                pathname === href
                  ? "border-gold-500 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <a
            href={DOCS_URL}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "hidden gap-2 px-4 lg:inline-flex")}
          >
            <BookOpen aria-hidden="true" />
            {t("nav.docs")}
          </a>
          {sections.registration && <Link
            href={registrationOpen ? "/register" : "/register/closed"}
            className={cn(buttonVariants({ size: "sm" }), "hidden px-5 lg:inline-flex")}
          >
            {registrationOpen ? t("nav.register") : "Registration status"}
          </Link>}

          {/* Mobile menu toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")}
            aria-expanded={open}
            aria-controls="mobile-navigation"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

    </header>

      <AnimatePresence>
        {open && (
          <motion.nav
            id="mobile-navigation"
            aria-label={t("nav.home")}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto border-t border-border bg-background lg:hidden"
          >
            <div className="flex min-h-full flex-col px-4 py-6">
              <ul className="divide-y divide-border/70 border-y border-border/70">
                {navLinks.map(({ href, label }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      aria-current={pathname === href ? "page" : undefined}
                      className={cn(
                        "flex items-center py-4 text-lg font-semibold transition-colors",
                        pathname === href ? "text-primary" : "text-foreground",
                      )}
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
              {sections.registration && <Link
                href={registrationOpen ? "/register" : "/register/closed"}
                onClick={() => setOpen(false)}
                className={cn(buttonVariants({ size: "lg" }), "mt-8 w-full")}
              >
                {registrationOpen ? t("nav.register") : "Registration status"}
              </Link>}
              <a
                href={DOCS_URL}
                onClick={() => setOpen(false)}
                className={cn(buttonVariants({ variant: "outline", size: "lg" }), sections.registration ? "mt-3" : "mt-8", "w-full gap-2")}
              >
                <BookOpen aria-hidden="true" />
                {t("nav.docs")}
              </a>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </>
  );
}
