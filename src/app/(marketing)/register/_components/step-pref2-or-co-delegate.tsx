import { useMemo } from "react"
import { type UseFormReturn } from "react-hook-form"
import type { RegisterFormValues } from "@/lib/schemas/register"
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { t } from "@/content/strings"
import { toSelectItems } from "@/lib/utils"
import { PortfolioPreferenceField, type PortfolioOption } from "./portfolio-preference-field"

interface Committee {
  id: string
  name: string
  doubleDelegation: boolean
  portfolios?: PortfolioOption[]
}

interface Props {
  form: UseFormReturn<RegisterFormValues>
  committees: Committee[]
  isDoubleDelegation: boolean
}

export function StepPref2OrCoDelegate({ form, committees, isDoubleDelegation }: Props) {
  const pref1CommitteeId = form.watch("pref1CommitteeId")
  const pref2Committees = useMemo(
    () => committees.filter((c) => c.id !== pref1CommitteeId),
    [committees, pref1CommitteeId]
  )
  const pref2CommitteeItems = useMemo(
    () => toSelectItems(pref2Committees, (c) => c.id, (c) => c.name),
    [pref2Committees]
  )

  // Which committee runs double delegation is an event-by-event decision, so the
  // copy names whichever one the delegate actually chose.
  const doubleCommitteeName =
    committees.find((c) => c.id === form.watch("pref1CommitteeId"))?.name ?? ""

  if (isDoubleDelegation) {
    return (
      <div className="space-y-5">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
          {t("register.preferences.doubleDelegationOnlyNote", { committee: doubleCommitteeName })}
        </div>

        <p className="text-base font-semibold">{t("register.coDelegate.sectionTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("register.coDelegate.sectionNote", { committee: doubleCommitteeName })}</p>

        <FormField
          control={form.control}
          name="coDelegate.fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("register.coDelegate.fullNameLabel")}</FormLabel>
              <FormControl>
                <Input placeholder="Co-delegate's full name" {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="coDelegate.email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("register.coDelegate.emailLabel")}</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder={t("register.coDelegate.emailPlaceholder")}
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="coDelegate.phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("register.coDelegate.phoneLabel")}</FormLabel>
              <FormControl>
                <Input placeholder="+91 9876543210" {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="coDelegate.institution"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("register.coDelegate.institutionLabel")}
                <span className="ml-1 text-xs text-muted-foreground">({t("common.optional")})</span>
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="Co-delegate's institution"
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="coDelegate.munExperience"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("register.coDelegate.munExperienceLabel")}
                <span className="ml-1 text-xs text-muted-foreground">({t("common.optional")})</span>
              </FormLabel>
              <FormControl>
                <Textarea
                  placeholder="List committees attended (if any)"
                  className="resize-none"
                  rows={3}
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Both fields are optional. You can skip this step or leave it blank.
      </p>

      <FormField
        control={form.control}
        name="pref2CommitteeId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              {t("register.preferences.pref2CommitteeLabel")}
              <span className="ml-1 text-xs text-muted-foreground">({t("common.optional")})</span>
            </FormLabel>
            <Select
              items={pref2CommitteeItems}
              value={field.value ?? ""}
              onValueChange={(v) => field.onChange(v || undefined)}
            >
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a committee (optional)" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {pref2Committees.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <PortfolioPreferenceField
        form={form}
        nameField="pref2Portfolio"
        idField="pref2PortfolioId"
        label={t("register.preferences.pref2PortfolioLabel")}
        portfolios={
          committees.find((c) => c.id === form.watch("pref2CommitteeId"))?.portfolios ?? []
        }
      />
    </div>
  )
}
