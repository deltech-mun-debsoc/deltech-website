import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Clock, PenLine } from "lucide-react"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { t } from "@/content/strings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AccountLink } from "@/components/account-link"
import { SignOutButton } from "@/components/sign-out-button"
import { cn } from "@/lib/utils"
import { createDraft } from "@/app/(author)/write/actions"
import { StartWritingForm } from "./_components/start-writing-form"

export const metadata: Metadata = {
  title: t("blog.write.metaTitle"),
  description: t("blog.write.metaDescription"),
}

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: t("blog.write.statusDraft"), variant: "secondary" },
  PENDING: { label: t("blog.write.statusPending"), variant: "outline" },
  CHANGES_REQUESTED: { label: t("blog.write.statusChanges"), variant: "destructive" },
  PUBLISHED: { label: t("blog.write.statusPublished"), variant: "default" },
  REJECTED: { label: t("blog.write.statusRejected"), variant: "destructive" },
}

export default async function BlogWritePage() {
  const session = await auth()
  if (!session?.user?.id) return <Welcome />
  return <Desk userId={session.user.id} name={session.user.name ?? null} />
}

function Welcome() {
  const steps = [
    [t("blog.write.step1Title"), t("blog.write.step1Body")],
    [t("blog.write.step2Title"), t("blog.write.step2Body")],
    [t("blog.write.step3Title"), t("blog.write.step3Body")],
  ]
  return (
    <section className="py-20 sm:py-28">
      <div className="section-shell grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20">
        <div>
          <p className="eyebrow">{t("blog.write.eyebrow")}</p>
          <h1 className="display-section mt-6 max-w-[14ch]">{t("blog.write.title")}</h1>
          <p className="body-large mt-7 max-w-xl text-muted-foreground">{t("blog.write.body")}</p>
          <h2 className="data-label mt-12 text-muted-foreground">{t("blog.write.stepsLabel")}</h2>
          <ol className="mt-4 border-t border-foreground/20">
            {steps.map(([title, body], index) => (
              <li key={title} className="grid gap-3 border-b border-foreground/20 py-6 sm:grid-cols-[3.5rem_1fr]">
                <span className="font-mono text-sm font-semibold text-primary">0{index + 1}</span>
                <div>
                  <h3 className="font-heading text-xl">{title}</h3>
                  <p className="mt-1.5 max-w-lg text-base leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="lg:pt-24">
          <div className="editorial-card border border-foreground/15 bg-card p-6 sm:p-8">
            <PenLine className="size-6 text-primary" aria-hidden />
            <h2 className="mt-4 font-heading text-2xl">{t("blog.write.formTitle")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("blog.write.formBody")}</p>
            <div className="mt-6">
              <StartWritingForm />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

async function Desk({ userId, name }: { userId: string; name: string | null }) {
  const posts = await prisma.post.findMany({
    where: { authorId: userId },
    orderBy: [{ submittedAt: { sort: "desc", nulls: "first" } }, { id: "desc" }],
    select: { id: true, title: true, subtitle: true, slug: true, status: true, readMin: true, reviewNote: true },
  })
  const firstName = name?.split(" ")[0]

  return (
    <section className="py-16 sm:py-24">
      <div className="section-shell">
        <div className="flex flex-col gap-8 border-b border-foreground/20 pb-10 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow">{t("blog.write.deskEyebrow")}</p>
            <h1 className="display-section mt-5 max-w-[16ch]">
              {firstName
                ? t(posts.length ? "blog.write.deskGreeting" : "blog.write.deskGreetingNew", { name: firstName })
                : t("blog.write.deskGreetingAnon")}
            </h1>
            <p className="body-large mt-5 max-w-xl text-muted-foreground">{t("blog.write.deskBody")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <form action={createDraft}>
              <Button type="submit" size="lg" className="gap-2">
                <PenLine className="size-4" aria-hidden />
                {t("blog.write.newStory")}
              </Button>
            </form>
            <AccountLink compact />
            <SignOutButton compact />
          </div>
        </div>

        {posts.length === 0 ? (
          <div className="noise-wash mt-12 border-y border-border px-6 py-14 sm:px-10">
            <h2 className="font-heading text-3xl">{t("blog.write.emptyTitle")}</h2>
            <p className="mt-3 text-base text-muted-foreground">{t("blog.write.emptyBody")}</p>
            <ul className="mt-6 space-y-3">
              {[t("blog.write.prompt1"), t("blog.write.prompt2"), t("blog.write.prompt3")].map((prompt) => (
                <li key={prompt} className="flex gap-3 text-base">
                  <ArrowRight className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
                  {prompt}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <h2 className="data-label mt-12 text-muted-foreground">{t("blog.write.storiesLabel")}</h2>
            <ul className="mt-4 border-t border-foreground/20">
              {posts.map((post) => {
                const status = STATUS[post.status] ?? STATUS.DRAFT
                const published = post.status === "PUBLISHED"
                const note =
                  post.reviewNote && (post.status === "CHANGES_REQUESTED" || post.status === "REJECTED")
                    ? post.reviewNote
                    : null
                return (
                  <li key={post.id} className="border-b border-foreground/20">
                    <Link
                      href={published ? `/blog/${post.slug}` : `/write/${post.id}`}
                      className="group grid gap-4 py-7 sm:grid-cols-[1fr_auto] sm:items-start"
                    >
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "font-heading text-2xl leading-tight transition-colors group-hover:text-primary",
                            !post.title && "text-muted-foreground",
                          )}
                        >
                          {post.title || t("blog.write.untitled")}
                        </p>
                        {post.subtitle && <p className="mt-2 line-clamp-2 text-base text-muted-foreground">{post.subtitle}</p>}
                        {note && (
                          <p
                            className={cn(
                              "mt-3 border-l-2 px-3 py-2 text-sm",
                              post.status === "REJECTED"
                                ? "border-destructive bg-destructive/5"
                                : "border-gold-500 bg-gold-500/10",
                            )}
                          >
                            <span className="font-semibold">{t("blog.write.editorNote")}: </span>
                            {note}
                          </p>
                        )}
                        {published && (
                          <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                            {t("blog.write.readArticle")}
                            <ArrowRight className="size-4" aria-hidden />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                        <Badge variant={status.variant}>{status.label}</Badge>
                        {post.readMin ? (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="size-3" aria-hidden />
                            {t("blog.readMin", { n: post.readMin })}
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
