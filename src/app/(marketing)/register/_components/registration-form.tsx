"use client"

import { useEffect, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { DTU_INSTITUTION, registerSchema, type RegisterFormValues } from "@/lib/schemas/register"
import { registerDelegate } from "../actions"
import { Form } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { t } from "@/content/strings"
import { Stepper } from "./stepper"
import { StepPersonal } from "./step-personal"
import { StepPref1 } from "./step-pref1"
import { StepPref2OrCoDelegate } from "./step-pref2-or-co-delegate"
import { StepAccommodation } from "./step-accommodation"
import { StepUndertaking } from "./step-undertaking"
import { useDtuInstitution } from "../_hooks/use-dtu-institution"

interface Committee {
  id: string
  name: string
  doubleDelegation: boolean
}

interface Props {
  committees: Committee[]
  // An Intra MUN is for DTU students: no college or accommodation to ask about.
  intra?: boolean
}

type StepKey = "personal" | "preferences" | "coDelegateOrPref2" | "accommodation" | "undertaking"

const STEP_LABEL: Record<StepKey, string> = {
  personal: t("register.steps.personal"),
  preferences: t("register.steps.preferences"),
  coDelegateOrPref2: t("register.steps.coDelegateOrPref2"),
  accommodation: t("register.steps.accommodation"),
  undertaking: t("register.steps.undertaking"),
}

export function RegistrationForm({ committees, intra = false }: Props) {
  const stepKeys: StepKey[] = intra
    ? ["personal", "preferences", "coDelegateOrPref2", "undertaking"]
    : ["personal", "preferences", "coDelegateOrPref2", "accommodation", "undertaking"]

  const [step, setStep] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Synchronous lock: the disabled-button state updates a paint later, so a
  // fast double-click or Enter could fire onSubmit twice before it applies.
  const submitLock = useRef(false)
  const router = useRouter()
  const current = stepKeys[step]

  // Move focus to the step heading on each step change so keyboard and
  // screen-reader users land on the new step's content (not stranded on the
  // now-hidden previous "Next" button). Skip the initial mount.
  const headingRef = useRef<HTMLHeadingElement>(null)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    headingRef.current?.focus()
  }, [step])

  const form = useForm<RegisterFormValues, unknown, RegisterFormValues>({
    resolver: zodResolver(registerSchema) as never,
    defaultValues: {
      fullName: "",
      email: "",
      whatsapp: "",
      altPhone: "",
      institution: intra ? DTU_INSTITUTION : "",
      isDtu: intra,
      rollNumber: "",
      munExperience: "",
      pref1CommitteeId: "",
      pref1Portfolio: "",
      pref2CommitteeId: "",
      pref2Portfolio: "",
      needsAccommodation: false,
      outsideNcr: false,
      undertaking: false,
      reference: "",
    },
  })

  const pref1CommitteeId = form.watch("pref1CommitteeId")
  const pref1Committee = committees.find((c) => c.id === pref1CommitteeId)
  const isDoubleDelegation = pref1Committee?.doubleDelegation ?? false
  // Step 3 is a co-delegate for a double-delegation committee and a second
  // preference otherwise; name it for what it will be once a committee is chosen.
  const steps = stepKeys.map((key) =>
    key !== "coDelegateOrPref2" || !pref1CommitteeId
      ? STEP_LABEL[key]
      : isDoubleDelegation
        ? t("register.steps.coDelegate")
        : t("register.steps.secondPreference"),
  )

  const { onDtuChange } = useDtuInstitution(form)

  const handleNext = async () => {
    if (current === "coDelegateOrPref2") {
      // Co-delegate fields are required when the chosen committee uses double-delegation
      if (isDoubleDelegation) {
        const valid = await form.trigger([
          "coDelegate.fullName",
          "coDelegate.email",
          "coDelegate.phone",
        ] as Parameters<typeof form.trigger>[0])
        if (!valid) return
      }
      setStep((s) => s + 1)
      return
    }

    if (current === "personal") {
      const valid = await form.trigger(intra ? ["fullName", "email", "whatsapp"] : ["fullName", "email", "whatsapp", "institution"])
      if (!valid) return
      if (intra && !form.getValues("rollNumber")?.trim()) {
        form.setError("rollNumber", { message: t("register.personal.rollNumberRequired") })
        return
      }
      setStep((s) => s + 1)
      return
    }

    const fields: (keyof RegisterFormValues)[] =
      current === "preferences" ? ["pref1CommitteeId", "pref1Portfolio"] : current === "undertaking" ? ["undertaking"] : []
    const valid = await form.trigger(fields)
    if (valid) setStep((s) => s + 1)
  }

  const onSubmit = async (data: RegisterFormValues) => {
    if (submitLock.current) return // already in flight, ignore the repeat
    submitLock.current = true
    setIsSubmitting(true)
    try {
      const result = await registerDelegate(data)
      if (result.success) {
        router.push(`/register/success?t=${result.publicToken}`)
      } else {
        toast.error(result.error ?? t("toast.errorGeneric"))
      }
    } catch {
      toast.error(t("toast.errorGeneric"))
    } finally {
      submitLock.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      <Stepper steps={steps} currentStep={step} />

      {/* Focus lands here on each step change, announcing the new step to
          screen readers (visually hidden, the Stepper conveys progress). */}
      <h2 ref={headingRef} tabIndex={-1} className="sr-only">
        {`Step ${step + 1} of ${steps.length}: ${steps[step]}`}
      </h2>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {current === "personal" && <StepPersonal form={form} onDtuChange={onDtuChange} intra={intra} />}
          {current === "preferences" && <StepPref1 form={form} committees={committees} />}
          {current === "coDelegateOrPref2" && (
            <StepPref2OrCoDelegate
              form={form}
              committees={committees}
              isDoubleDelegation={isDoubleDelegation}
            />
          )}
          {current === "accommodation" && <StepAccommodation form={form} />}
          {current === "undertaking" && <StepUndertaking form={form} isSubmitting={isSubmitting} />}

          <div className="flex items-center justify-between pt-2">
            {step > 0 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep((s) => s - 1)}
                disabled={isSubmitting}
              >
                {t("common.back")}
              </Button>
            ) : (
              <div />
            )}

            {step < steps.length - 1 ? (
              <Button type="button" onClick={handleNext}>
                {t("common.next")}
              </Button>
            ) : (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t("common.saving") : t("register.undertaking.submitButton")}
              </Button>
            )}
          </div>
        </form>
      </Form>
    </div>
  )
}
