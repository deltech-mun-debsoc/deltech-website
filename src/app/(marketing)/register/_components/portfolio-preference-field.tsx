import { type UseFormReturn } from "react-hook-form"
import type { RegisterFormValues } from "@/lib/schemas/register"
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { t } from "@/content/strings"
import { toSelectItems } from "@/lib/utils"

export interface PortfolioOption {
  id: string
  name: string
}

// One preference, captured as a real seat when there is a matrix to pick from and
// as free text when there is not.
//
// Both are written. The id is exact, so staff can see who asked for this chair
// without guessing; the name is what survives the matrix being republished, and
// it is the only thing a Google Form import ever supplies. Neither replaces the
// other, which is why this writes the pair rather than choosing between them.
export function PortfolioPreferenceField({
  form,
  nameField,
  idField,
  label,
  portfolios,
}: {
  form: UseFormReturn<RegisterFormValues>
  nameField: "pref1Portfolio" | "pref2Portfolio"
  idField: "pref1PortfolioId" | "pref2PortfolioId"
  label: string
  portfolios: PortfolioOption[]
}) {
  const hasMatrix = portfolios.length > 0
  const items = toSelectItems(portfolios, (p) => p.id, (p) => p.name)

  return (
    <FormField
      control={form.control}
      name={nameField}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          {hasMatrix ? (
            <Select
              items={items}
              value={form.watch(idField) ?? ""}
              onValueChange={(value) => {
                form.setValue(idField, value ?? "")
                // Store the name too, so the preference stays readable if this
                // seat is removed when the matrix is republished.
                field.onChange(portfolios.find((p) => p.id === value)?.name ?? "")
              }}
            >
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("register.preferences.portfolioPickPlaceholder")} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {portfolios.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <FormControl>
              <Input placeholder={t("register.preferences.pref1PortfolioPlaceholder")} {...field} />
            </FormControl>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
