import { type UseFormReturn } from "react-hook-form"
import type { RegisterFormValues } from "@/lib/schemas/register"
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { t } from "@/content/strings"

interface Props {
  form: UseFormReturn<RegisterFormValues>
  isSubmitting: boolean
  // The Intra form is two steps and does not ask where they heard about us.
  showReference?: boolean
}

export function StepUndertaking({ form, isSubmitting, showReference = true }: Props) {
  return (
    <div className="space-y-6">
      {showReference && <FormField
        control={form.control}
        name="reference"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              {t("register.undertaking.referenceLabel")}
              <span className="ml-1 text-xs text-muted-foreground">({t("common.optional")})</span>
            </FormLabel>
            <FormControl>
              <Input
                placeholder={t("register.undertaking.referencePlaceholder")}
                disabled={isSubmitting}
                {...field}
                value={field.value ?? ""}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />}

      <FormField
        control={form.control}
        name="undertaking"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-start gap-3">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked)}
                  disabled={isSubmitting}
                  className="mt-0.5"
                />
              </FormControl>
              <Label className="cursor-pointer text-sm leading-relaxed">
                {t("register.undertaking.checkboxLabel")}
              </Label>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}
