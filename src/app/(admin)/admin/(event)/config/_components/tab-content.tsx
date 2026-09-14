"use client"

import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { saveContent } from "../actions"
import type { Content } from "@/content/contentSchema"

const schema = z.object({
  heroTitle: z.string(),
  societyLocation: z.string(),
  societyEmail: z.string().email(),
  agendasBlurb: z.string(),
  accommodationNote: z.string(),
  blogIntro: z.string(),
  awardsText: z.string(),
  contacts: z.array(
    z.object({ name: z.string(), role: z.string(), phone: z.string() }),
  ),
})

type FormValues = z.infer<typeof schema>

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">{title}</p>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

interface Props {
  content: Content
}

// The society's standing copy. The event's own name, brief, dates, venue and
// button text live in Event control, so they are not edited twice.
export function TabContent({ content }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const form = useForm<FormValues, unknown, FormValues>({
    defaultValues: {
      heroTitle: content.landingHero.title,
      societyLocation: content.societyLocation,
      societyEmail: content.societyEmail,
      agendasBlurb: content.agendasBlurb,
      accommodationNote: content.accommodationNote,
      blogIntro: content.blogIntro,
      awardsText: content.awards.join("\n"),
      contacts: content.queryContacts,
    },
    resolver: zodResolver(schema) as never,
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "contacts",
  })

  const onSubmit = form.handleSubmit((data) => {
    startTransition(async () => {
      const result = await saveContent({
        landingHero: { ...content.landingHero, title: data.heroTitle },
        societyLocation: data.societyLocation,
        societyEmail: data.societyEmail,
        agendasBlurb: data.agendasBlurb,
        accommodationNote: data.accommodationNote,
        blogIntro: data.blogIntro,
        awards: data.awardsText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        queryContacts: data.contacts,
      })
      if (result.success) {
        toast.success("Content saved.")
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed to save.")
      }
    })
  })

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-8">
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {"The event's name, brief, dates, venue and register button are set in "}
        <Link href="/admin/config" className="font-medium text-foreground underline underline-offset-2">Event control</Link>.
      </p>

      <Section title="Society">
        <Field label="Name shown in the site header">
          <Input {...form.register("heroTitle")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Location">
            <Input {...form.register("societyLocation")} />
          </Field>
          <Field label="Email">
            <Input type="email" {...form.register("societyEmail")} />
          </Field>
        </div>
      </Section>

      <Separator />

      <Section title="Public copy">
        <Field label="Agendas blurb">
          <Textarea {...form.register("agendasBlurb")} />
        </Field>
        <Field label="Accommodation note">
          <Textarea {...form.register("accommodationNote")} />
        </Field>
        <Field label="Blog intro">
          <Textarea {...form.register("blogIntro")} />
        </Field>
      </Section>

      <Separator />

      <Section title="Awards">
        <Field label="One award per line">
          <Textarea {...form.register("awardsText")} rows={5} placeholder="Best Delegate&#10;High Commendation&#10;Verbal Mention" />
        </Field>
      </Section>

      <Separator />

      <Section title="Query contacts">
        <p className="text-sm leading-relaxed text-muted-foreground">
          These people appear on the public site and sign automated allotment and payment-confirmation emails. Update them at the start of every Secretariat term.
        </p>
        <div className="space-y-3">
          {fields.map((field, i) => (
            <div key={field.id} className="flex items-start gap-2">
              <div className="grid flex-1 gap-2 sm:grid-cols-3">
                <Input {...form.register(`contacts.${i}.name`)} placeholder="Name" />
                <Input {...form.register(`contacts.${i}.role`)} placeholder="Role" />
                <Input {...form.register(`contacts.${i}.phone`)} placeholder="Phone" />
              </div>
              <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label="Remove contact" onClick={() => remove(i)}>
                <Trash2 className="size-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => append({ name: "", role: "", phone: "" })}>
            <Plus className="size-3.5" /> Add contact
          </Button>
        </div>
      </Section>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save all changes"}
        </Button>
      </div>
    </form>
  )
}
