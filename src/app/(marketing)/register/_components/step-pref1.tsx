import { useMemo } from "react"
import { type UseFormReturn } from "react-hook-form"
import type { RegisterFormValues } from "@/lib/schemas/register"
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
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
}

export function StepPref1({ form, committees }: Props) {
  const committeeItems = useMemo(
    () => toSelectItems(committees, (c) => c.id, (c) => c.name),
    [committees]
  )

  return (
    <div className="space-y-5">
      <FormField
        control={form.control}
        name="pref1CommitteeId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("register.preferences.pref1CommitteeLabel")}</FormLabel>
            <Select items={committeeItems} value={field.value} onValueChange={(v) => field.onChange(v)}>
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a committee" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {committees.map((c) => (
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
        nameField="pref1Portfolio"
        idField="pref1PortfolioId"
        label={t("register.preferences.pref1PortfolioLabel")}
        portfolios={
          committees.find((c) => c.id === form.watch("pref1CommitteeId"))?.portfolios ?? []
        }
      />
    </div>
  )
}
