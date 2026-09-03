"use client"

import { useTransition, useEffect } from "react"
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
  heroSubtitle: z.string(),
  heroCtaLabel: z.string(),
  conferenceDates: z.string(),
  venue: z.string(),
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

export function TabContent({ content }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const form = useForm<FormValues, unknown, FormValues>({
    defaultValues: {
      heroTitle: content.landingHero.title,
      heroSubtitle: content.landingHero.subtitle,
      heroCtaLabel: content.landingHero.ctaLabel,
      conferenceDates: content.conferenceDates,
      venue: content.venue,
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
        landingHero: {
          title: data.heroTitle,
          subtitle: data.heroSubtitle,
          ctaLabel: data.heroCtaLabel,
        },
        conferenceDates: data.conferenceDates,
        venue: data.venue,
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
      {/* Hero */}
      <Section title="Landing Hero">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title">
            <Input {...form.register("heroTitle")} />
          </Field>
          <Field label="CTA button label">
            <Input {...form.register("heroCtaLabel")} />
          </Field>
        </div>
        <Field label="Subtitle">
          <Textarea {...form.register("heroSubtitle")} />
        </Field>
      </Section>

      <Separator />

      {/* Conference details */}
      <Section title="Conference Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dates">
            <Input {...form.register("conferenceDates")} placeholder="e.g. 14–16 Feb 2025" />
          </Field>
          <Field label="Venue">
            <Input {...form.register("venue")} />
          </Field>
        </div>
      </Section>

      <Separator />

      {/* Copy */}
      <Section title="Public Copy">
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

      {/* Awards */}
      <Section title="Awards">
        <Field label="One award per line">
          <Textarea {...form.register("awardsText")} rows={5} placeholder="Best Delegate&#10;High Commendation&#10;Verbal Mention" />
        </Field>
      </Section>

      <Separator />

      {/* Query contacts */}
      <Section title="Society Contact">
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

      <Section title="Query Contacts">
        <p className="text-sm leading-relaxed text-muted-foreground">
          These people appear on the public site and sign automated allotment and payment-confirmation emails. Update them at the start of every Secretariat term.
        </p>
        <div className="space-y-3">
          {fields.map((field, i) => (
            <div key={field.id} className="flex items-start gap-2">
              <div className="grid flex-1 gap-2 sm:grid-cols-3">
                <Input
                  {...form.register(`contacts.${i}.name`)}
                  placeholder="Name"
                />
                <Input
                  {...form.register(`contacts.${i}.role`)}
                  placeholder="Role"
                />
                <Input
                  {...form.register(`contacts.${i}.phone`)}
                  placeholder="Phone"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => remove(i)}
              >
                <Trash2 className="size-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => append({ name: "", role: "", phone: "" })}
          >
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
