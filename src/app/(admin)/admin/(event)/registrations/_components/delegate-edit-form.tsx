"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { t } from "@/content/strings"
import type { SerializedDelegate } from "../_lib/types"
import { updateDelegate, type DelegateEditData } from "../actions"

const editSchema = z.object({
  fullName: z.string().min(2, "Enter their name"),
  email: z.string().email("Enter a valid email"),
  whatsapp: z.string().min(7, "Enter a valid number"),
  altPhone: z.string().optional(),
  institution: z.string().min(2, "Enter their college"),
  isDtu: z.boolean(),
  rollNumber: z.string().optional(),
  munExperience: z.string().optional(),
  pref1Portfolio: z.string().optional(),
  pref2Portfolio: z.string().optional(),
  needsAccommodation: z.boolean(),
  outsideNcr: z.boolean(),
  reference: z.string().optional(),
})

type EditFormValues = z.infer<typeof editSchema>

interface Props {
  delegate: SerializedDelegate
  intra?: boolean
  onSuccess: (updated: SerializedDelegate) => void
  onCancel: () => void
}

function Optional() {
  return <span className="text-xs font-normal text-muted-foreground">optional</span>
}

export function DelegateEditForm({ delegate, intra = false, onSuccess, onCancel }: Props) {
  const [saving, setSaving] = useState(false)

  const form = useForm<EditFormValues, unknown, EditFormValues>({
    resolver: zodResolver(editSchema) as never,
    defaultValues: {
      fullName: delegate.fullName,
      email: delegate.email,
      whatsapp: delegate.whatsapp,
      altPhone: delegate.altPhone ?? "",
      institution: delegate.institution,
      isDtu: delegate.isDtu,
      rollNumber: delegate.rollNumber ?? "",
      munExperience: delegate.munExperience ?? "",
      pref1Portfolio: delegate.pref1Portfolio ?? "",
      pref2Portfolio: delegate.pref2Portfolio ?? "",
      needsAccommodation: delegate.needsAccommodation,
      outsideNcr: delegate.outsideNcr,
      reference: delegate.reference ?? "",
    },
  })

  const onSubmit = async (data: EditFormValues) => {
    if (intra && !data.rollNumber?.trim()) {
      form.setError("rollNumber", { message: "Enter their roll number" })
      return
    }
    setSaving(true)
    const result = await updateDelegate(delegate.id, data as DelegateEditData)
    setSaving(false)
    if (result.success) {
      toast.success("Saved.")
      onSuccess({ ...delegate, ...data })
    } else {
      toast.error(result.error ?? "Could not save.")
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <p className="text-sm text-muted-foreground">Everything is needed unless it says optional.</p>
        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl><Input {...field} disabled={saving} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" {...field} disabled={saving} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="whatsapp"
            render={({ field }) => (
              <FormItem>
                <FormLabel>WhatsApp</FormLabel>
                <FormControl><Input type="tel" {...field} disabled={saving} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="altPhone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Other phone <Optional /></FormLabel>
                <FormControl><Input type="tel" {...field} value={field.value ?? ""} disabled={saving} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {intra ? (
            <FormField
              control={form.control}
              name="rollNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>DTU roll number</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} placeholder={t("admin.formSync.rollPlaceholder")} disabled={saving} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : (
            <FormField
              control={form.control}
              name="institution"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>College</FormLabel>
                  <FormControl><Input {...field} disabled={saving} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        {!intra && (
          <FormField
            control={form.control}
            name="isDtu"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked)} disabled={saving} />
                  </FormControl>
                  <Label className="cursor-pointer text-sm font-normal">DTU student</Label>
                </div>
              </FormItem>
            )}
          />
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="pref1Portfolio"
            render={({ field }) => (
              <FormItem>
                <FormLabel>1st choice portfolio <Optional /></FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} disabled={saving} /></FormControl>
              </FormItem>
            )}
          />
          {!delegate.coDelegate && (
            <FormField
              control={form.control}
              name="pref2Portfolio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>2nd choice portfolio <Optional /></FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ""} disabled={saving} /></FormControl>
                </FormItem>
              )}
            />
          )}
        </div>

        <FormField
          control={form.control}
          name="munExperience"
          render={({ field }) => (
            <FormItem>
              <FormLabel>MUN experience <Optional /></FormLabel>
              <FormControl>
                <Textarea {...field} value={field.value ?? ""} rows={3} className="resize-none" disabled={saving} />
              </FormControl>
            </FormItem>
          )}
        />

        {!intra && (
          <div className="flex flex-wrap gap-6">
            <FormField
              control={form.control}
              name="needsAccommodation"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked)} disabled={saving} />
                    </FormControl>
                    <Label className="cursor-pointer text-sm font-normal">Needs accommodation</Label>
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="outsideNcr"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked)} disabled={saving} />
                    </FormControl>
                    <Label className="cursor-pointer text-sm font-normal">From outside NCR</Label>
                  </div>
                </FormItem>
              )}
            />
          </div>
        )}

        <FormField
          control={form.control}
          name="reference"
          render={({ field }) => (
            <FormItem>
              <FormLabel>How they heard about us <Optional /></FormLabel>
              <FormControl><Input {...field} value={field.value ?? ""} disabled={saving} /></FormControl>
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 border-t border-border/60 pt-5">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Form>
  )
}
