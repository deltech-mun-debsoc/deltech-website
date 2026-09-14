"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { Content } from "@/content/contentSchema"
import { saveContent } from "@/app/(admin)/admin/(event)/config/actions"

const ROWS = [
  ["dispatch", "Dispatch", "The society's writing, on the blog."],
  ["team", "Team", "The council and team page."],
  ["quiz", "Live quiz", "The link for audiences to join a quiz."],
  ["recruitment", "Recruitment", "The recruitment page, while the society is hiring."],
] as const

export function SiteSections({ sections }: { sections: Content["publicSections"] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [value, setValue] = useState(sections)

  const change = (key: (typeof ROWS)[number][0], checked: boolean) => {
    const previous = value
    const next = { ...value, [key]: checked }
    setValue(next)
    startTransition(async () => {
      const result = await saveContent({ publicSections: next })
      if (!result.success) {
        setValue(previous)
        toast.error(result.error ?? "Could not save.")
        return
      }
      toast.success(checked ? "Shown on the website." : "Hidden from the website.")
      router.refresh()
    })
  }

  return (
    <div className="max-w-3xl divide-y divide-border border-y border-border">
      {ROWS.map(([key, title, body]) => (
        <div key={key} className="flex items-center justify-between gap-6 py-5">
          <div>
            <Label htmlFor={`site-${key}`} className="text-base font-semibold">{title}</Label>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </div>
          <Switch id={`site-${key}`} checked={value[key]} disabled={pending} onCheckedChange={(checked) => change(key, checked)} />
        </div>
      ))}
    </div>
  )
}
