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
  fullName: z.string().min(2, "Name is required"),
  email: z.string().email("Enter a valid email"),
  whatsapp: z.string().min(7, "Enter a valid number"),
  altPhone: z.string().optional(),
  institution: z.string().min(2, "Institution is required"),
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
  onSuccess: (updated: SerializedDelegate) => void
  onCancel: () => void
}

export function DelegateEditForm({ delegate, onSuccess, onCancel }: Props) {
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
    setSaving(true)
    const result = await updateDelegate(delegate.id, data as DelegateEditData)
    setSaving(false)
    if (result.success) {
      toast.success("Delegate updated.")
      onSuccess({ ...delegate, ...data })
    } else {
      toast.error(result.error ?? "Update failed.")
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="fullName"
            render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>Full name</FormLabel>
                <FormControl><Input {...field} disabled={saving} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
                <FormControl><Input {...field} disabled={saving} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="altPhone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Alt phone <span className="text-xs text-muted-foreground">(optional)</span></FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} disabled={saving} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="institution"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Institution</FormLabel>
                <FormControl><Input {...field} disabled={saving} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="isDtu"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center gap-2">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked)} disabled={saving} />
                </FormControl>
                <Label className="cursor-pointer text-sm">DTU student</Label>
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="rollNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>DTU roll number <span className="text-xs text-muted-foreground">(optional)</span></FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} placeholder={t("admin.formSync.rollPlaceholder")} disabled={saving} />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="munExperience"
          render={({ field }) => (
            <FormItem>
              <FormLabel>MUN experience <span className="text-xs text-muted-foreground">(optional)</span></FormLabel>
              <FormControl>
                <Textarea {...field} value={field.value ?? ""} rows={2} className="resize-none" disabled={saving} />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="pref1Portfolio"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Pref 1 portfolio</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} disabled={saving} /></FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="pref2Portfolio"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Pref 2 portfolio</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} disabled={saving} /></FormControl>
              </FormItem>
            )}
          />
        </div>

        <div className="flex gap-4">
          <FormField
            control={form.control}
            name="needsAccommodation"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked)} disabled={saving} />
                  </FormControl>
                  <Label className="cursor-pointer text-sm">Needs accommodation</Label>
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
                  <Label className="cursor-pointer text-sm">Outside NCR</Label>
                </div>
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="reference"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reference <span className="text-xs text-muted-foreground">(optional)</span></FormLabel>
              <FormControl><Input {...field} value={field.value ?? ""} disabled={saving} /></FormControl>
            </FormItem>
          )}
        />

        <div className="flex gap-2 pt-2">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  )
}
