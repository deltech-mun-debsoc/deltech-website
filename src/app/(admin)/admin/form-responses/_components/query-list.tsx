"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { t } from "@/content/strings"
import { markQueryAnswered } from "../actions"

// "Any queries?" from the form. Each one is a question an organiser owes someone
// an answer to, so they are listed until somebody marks them answered, rather
// than sitting unread in a spreadsheet column.
export function QueryList({
  queries,
}: {
  queries: { id: string; name: string; email: string; phone: string; query: string }[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <section className="space-y-3">
      <h2 className="section-label">{t("admin.formSync.queriesTitle", { n: queries.length })}</h2>
      {queries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.formSync.queriesEmpty")}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("admin.formSync.queriesHelp")}</p>
          <ul className="divide-y divide-border/60 rounded-md border border-border/70">
            {queries.map((q) => (
              <li key={q.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{q.name}</p>
                  <p className="break-all text-sm text-muted-foreground">
                    {q.email}  ·  {q.phone}
                  </p>
                  <p className="whitespace-pre-line text-sm">{q.query}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await markQueryAnswered(q.id)
                      if (!result.ok) toast.error(result.error ?? "")
                      else {
                        toast.success(t("admin.formSync.answered"))
                        router.refresh()
                      }
                    })
                  }
                >
                  <Check className="size-4" />
                  {t("admin.formSync.markAnswered")}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
