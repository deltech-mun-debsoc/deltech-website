"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "@/content/strings";
import { ThemeToggle } from "./theme-toggle";
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
      <div className="section-shell flex h-20 items-center justify-between gap-5">
        <Link href="/" className="group flex items-center gap-3 text-foreground">
          <span className="display flex size-10 items-center justify-center rounded-full border border-foreground/25 text-xl transition-transform duration-300 group-hover:-rotate-6">
            D
          </span>
          <span>
            <span className="display block text-xl leading-none">{t("brand.name")}</span>
            <span className="mt-1 hidden text-[0.6875rem] font-semibold uppercase tracking-[0.15em] text-muted-foreground sm:block">
              Delhi Technological University
            </span>
          </span>
        </Link>

        <nav aria-label={t("nav.home")} className="hidden items-center gap-7 lg:flex">
          {navLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
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
            className="fixed inset-x-0 bottom-0 top-20 z-40 overflow-y-auto border-t border-border bg-background lg:hidden"
          >
            <div className="paper-grid flex min-h-full flex-col px-4 py-8">
              <p className="eyebrow mb-5">Society index</p>
              <ul className="divide-y divide-border/70 border-y border-border/70">
                {navLinks.map(({ href, label }, index) => (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center justify-between py-5 text-2xl font-heading transition-colors",
                        pathname === href ? "text-primary" : "text-foreground",
                      )}
                    >
                      <span>{label}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        0{index + 1}
                      </span>
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
              <p className="mt-auto pt-12 text-sm leading-relaxed text-muted-foreground">
                {t("brand.tagline")}
              </p>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </>
  );
}
