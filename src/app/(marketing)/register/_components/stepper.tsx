import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"

interface Props {
  steps: string[]
  currentStep: number
}

// Sized by its own width, not the viewport: the form sits in a narrow column
// beside the aside on desktop, where five labels used to crowd together. Labels
// under the circles only appear once the column can actually hold them;
// until then the current step is named in a line above.
export function Stepper({ steps, currentStep }: Props) {
  return (
    <nav aria-label={t("register.progressLabel")} className="@container border-b border-foreground/20 pb-7">
      <p className="mb-5 @2xl:hidden">
        <span className="block text-sm text-muted-foreground">
          {t("register.stepOf", { n: currentStep + 1, total: steps.length })}
        </span>
        <span className="mt-1 block font-heading text-2xl">{steps[currentStep]}</span>
      </p>
      <ol className="flex items-start">
        {steps.map((label, i) => {
          const done = i < currentStep
          const active = i === currentStep
          return (
            <li key={label} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-2">
                <div
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors @md:size-10",
                    done && "border-primary bg-primary text-primary-foreground",
                    active && "border-primary bg-background text-primary",
                    !done && !active && "border-muted-foreground/40 bg-background text-muted-foreground",
                  )}
                  aria-current={active ? "step" : undefined}
                >
                  {done ? <Check className="size-4" aria-hidden /> : i + 1}
                  <span className="sr-only">{" " + label}</span>
                </div>
                <span
                  aria-hidden
                  className={cn(
                    "hidden w-24 text-center text-xs font-semibold leading-tight @2xl:block",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  aria-hidden
                  className={cn(
                    "mx-2 mt-4 h-px flex-1 transition-colors @md:mt-5",
                    i < currentStep ? "bg-primary" : "bg-muted-foreground/20",
                  )}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
