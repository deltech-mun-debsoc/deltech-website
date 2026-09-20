import { type UseFormReturn } from "react-hook-form"
import type { RegisterFormValues } from "@/lib/schemas/register"
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { t } from "@/content/strings"
import { cn } from "@/lib/utils"

interface Props {
  form: UseFormReturn<RegisterFormValues>
  onDtuChange: (checked: boolean) => void
  // An Intra MUN is for DTU students only: a roll number replaces the college.
  intra?: boolean
}

export function StepPersonal({ form, onDtuChange, intra = false }: Props) {
  const isDtu = form.watch("isDtu")

  return (
    <div className="space-y-5">
      <FormField
        control={form.control}
        name="fullName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("register.personal.fullNameLabel")}</FormLabel>
            <FormControl>
              <Input placeholder={t("register.personal.fullNamePlaceholder")} autoComplete="name" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("register.personal.emailLabel")}</FormLabel>
            <FormControl>
              <Input
                type="email"
                autoComplete="email"
                placeholder={t("register.personal.emailPlaceholder")}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className={intra ? "" : "grid gap-4 sm:grid-cols-2"}>
        <FormField
          control={form.control}
          name="whatsapp"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("register.personal.whatsappLabel")}</FormLabel>
              <FormControl>
                <Input type="tel" autoComplete="tel" placeholder={t("register.personal.whatsappPlaceholder")} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {!intra && <FormField
          control={form.control}
          name="altPhone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("register.personal.altPhoneLabel")}
                <span className="ml-1 text-xs text-muted-foreground">
                  ({t("common.optional")})
                </span>
              </FormLabel>
              <FormControl>
                <Input
                  type="tel"
                  placeholder={t("register.personal.altPhonePlaceholder")}
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />}
      </div>

      {intra ? (
        <FormField
          control={form.control}
          name="rollNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("register.personal.rollNumberLabel")}</FormLabel>
              <FormControl>
                <Input placeholder={t("register.personal.rollNumberPlaceholder")} {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : (
        <>
          <FormField
            control={form.control}
            name="isDtu"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => onDtuChange(Boolean(checked))}
                    />
                  </FormControl>
                  <Label className="cursor-pointer text-sm font-medium leading-none">
                    {t("register.personal.isDtuLabel")}
                  </Label>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="institution"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("register.personal.institutionLabel")}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t("register.personal.institutionPlaceholder")}
                    {...field}
                    readOnly={isDtu}
                    aria-readonly={isDtu || undefined}
                    className={cn(isDtu && "cursor-not-allowed bg-muted text-muted-foreground")}
                  />
                </FormControl>
                {isDtu && (
                  <FormDescription>{t("register.personal.institutionLockedNote")}</FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}

      <FormField
        control={form.control}
        name="munExperience"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              {t("register.personal.munExperienceLabel")}
              <span className="ml-1 text-xs text-muted-foreground">({t("common.optional")})</span>
            </FormLabel>
            <FormControl>
              <Textarea
                placeholder={t("register.personal.munExperiencePlaceholder")}
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
