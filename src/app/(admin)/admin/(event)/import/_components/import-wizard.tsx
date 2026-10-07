"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Sparkles, Loader2 } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  applyMapping,
  mappedRowSchema,
  type ColumnMapping,
  type MappedRow,
  validatedFromCleaned,
  type ValidatedRow,
} from "@/lib/schemas/import"
import type { ImportPresetRecord } from "../actions"
import { suggestMappingWithGemini, cleanImportRowsWithGemini } from "../actions-ai"
import { StepUpload } from "./step-upload"
import { StepMapping } from "./step-mapping"
import { StepPreview } from "./step-preview"
import { StepCommit } from "./step-commit"

export type WizardStep = "upload" | "mapping" | "preview" | "commit"

const STEPS: { key: WizardStep; label: string }[] = [
  { key: "upload",  label: "Upload"      },
  { key: "mapping", label: "Map columns" },
  { key: "preview", label: "Preview"     },
  { key: "commit",  label: "Import"      },
]

// A linked partner sheet, already read with its saved mapping: the review
// starts at cleaning instead of at upload.
export interface WizardStart {
  headers: string[]
  rows:    Record<string, string>[]
  mapping: ColumnMapping
}

interface Props {
  presets:        ImportPresetRecord[]
  committeeNames: string[]
  start?:         WizardStart
}

export function ImportWizard({ presets: initialPresets, committeeNames, start }: Props) {
  const [step,               setStep]               = useState<WizardStep>("upload")
  const [headers,            setHeaders]            = useState<string[]>([])
  const [rawRows,            setRawRows]            = useState<Record<string, string>[]>([])
  const [mapping,            setMapping]            = useState<ColumnMapping>({})
  const [validated,          setValidated]          = useState<ValidatedRow[]>([])
  const [skipped,            setSkipped]            = useState<Set<number>>(new Set())
  const [defaultInstitution, setDefaultInstitution] = useState("")
  const [presets,            setPresets]            = useState(initialPresets)

  const [aiProcessing, startAiProcess] = useTransition()

  const displayStep  = aiProcessing ? "mapping" : step
  const currentIndex = STEPS.findIndex((s) => s.key === displayStep)

  // ── After file is parsed, auto-run AI pipeline ────────────────────────────
  const handleParsed = (
    parsedHeaders: string[],
    parsedRows: Record<string, string>[],
    institution: string,
    known?: ColumnMapping,
  ) => {
    setHeaders(parsedHeaders)
    setRawRows(parsedRows)
    setDefaultInstitution(institution)
    setMapping({})
    setValidated([])
    setSkipped(new Set())

    startAiProcess(async () => {
      try {
        // Step 1: auto-detect column mapping, unless the sheet brought its own
        const mapResult = known
          ? { success: true as const, mapping: known, rateLimited: false }
          : await suggestMappingWithGemini(parsedHeaders, parsedRows.slice(0, 5))

        if (!mapResult.success) {
          if (mapResult.rateLimited) {
            toast.error("AI quota exceeded, import paused. Please retry in a few minutes.")
            setStep("upload")
            return
          }
          toast.warning("AI could not detect column headers, please map manually.")
          setStep("mapping")
          return
        }

        const finalMapping: ColumnMapping = mapResult.mapping ?? {}
        setMapping(finalMapping)

        // Step 2: clean & normalise all rows
        const prelimRows = parsedRows.map((r) => applyMapping(r, finalMapping, institution))

        const cleanResult = await cleanImportRowsWithGemini(prelimRows, committeeNames)

        if (!cleanResult.success || !cleanResult.cleaned) {
          if (cleanResult.rateLimited) {
            toast.error("AI quota exceeded, import paused. Please retry in a few minutes.")
            setStep("upload")
            return
          }
          toast.warning(cleanResult.error ?? "AI normalisation failed, please review manually.")
          const fallback: ValidatedRow[] = parsedRows.map((r, i) => {
            const mapped = applyMapping(r, finalMapping, institution)
            const parse  = mappedRowSchema.safeParse(mapped)
            const errors = parse.success ? [] : parse.error.issues.map((e) => e.message)
            return { index: i, raw: r, mapped, errors }
          })
          setValidated(fallback)
          setStep("preview")
          return
        }

        // Auto-skip rows flagged as noise
        const validatedRows = validatedFromCleaned(cleanResult.cleaned, parsedRows)
        const autoSkipped = new Set(validatedRows.filter((r) => r.skip).map((r) => r.index))

        setValidated(validatedRows)
        setSkipped(autoSkipped)

        const noteCount = cleanResult.cleaned.filter((c) => c._note).length
        const skipCount = autoSkipped.size
        toast.success(
          [
            `${parsedRows.length} rows parsed.`,
            noteCount > 0 ? `AI normalised ${noteCount}.` : "",
            skipCount > 0 ? `${skipCount} noise row${skipCount !== 1 ? "s" : ""} auto-skipped.` : "",
          ].filter(Boolean).join(" "),
        )

        setStep("preview")
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI processing failed."
        toast.error(`${msg}, map columns manually.`)
        setStep("mapping")
      }
    })
  }

  // A linked sheet starts straight at cleaning, once per sheet read (the
  // wizard is keyed by it).
  const startedRef = useRef(false)
  useEffect(() => {
    if (!start || startedRef.current) return
    startedRef.current = true
    handleParsed(start.headers, start.rows, "", start.mapping)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start])

  // ── Inline row editing from preview ──────────────────────────────────────
  const handleRowUpdate = (index: number, field: keyof MappedRow, value: string) => {
    setValidated((prev) =>
      prev.map((row) => {
        if (row.index !== index) return row
        const updated: MappedRow = { ...row.mapped, [field]: value || undefined }
        const parse  = mappedRowSchema.safeParse(updated)
        const errors = parse.success ? [] : parse.error.issues.map((e) => e.message)
        return { ...row, mapped: updated, errors }
      }),
    )
  }

  const goNext = () => {
    const next = STEPS[currentIndex + 1]
    if (next) setStep(next.key)
  }
  const goBack = () => {
    const prev = STEPS[currentIndex - 1]
    if (prev) setStep(prev.key)
  }


  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {STEPS.map((s, i) => {
          const done   = i < currentIndex
          const active = s.key === displayStep
          const future = i > currentIndex
          return (
            <div key={s.key} className="flex flex-1 items-center">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    done   && "bg-primary text-primary-foreground",
                    active && "bg-primary/10 text-primary ring-2 ring-primary",
                    future && "bg-muted text-muted-foreground",
                    active && aiProcessing && "animate-pulse",
                  )}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span
                  className={cn(
                    "text-xs font-medium",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <Separator
                  orientation="horizontal"
                  className={cn("mx-3 flex-1", done ? "bg-primary/40" : "bg-border")}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* AI processing panel */}
      {aiProcessing && (
        <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center gap-5 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="size-7 text-primary animate-pulse" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">AI is analysing your data</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Detecting columns and normalising {rawRows.length} row{rawRows.length !== 1 ? "s" : ""}…
            </p>
          </div>
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Step panels */}
      {!aiProcessing && (
        <>
          {step === "upload" && (
            <StepUpload onParsed={handleParsed} />
          )}

          {step === "mapping" && (
            <StepMapping
              headers={headers}
              rawRows={rawRows}
              mapping={mapping}
              presets={presets}
              committeeNames={committeeNames}
              defaultInstitution={defaultInstitution}
              onMappingChange={setMapping}
              onPresetsChange={setPresets}
              onBack={goBack}
              onNext={(m, v) => {
                setMapping(m)
                setValidated(v)
                // The manual path keeps the non-data rows it found skipped too.
                setSkipped(new Set(v.filter((r) => r.skip).map((r) => r.index)))
                goNext()
              }}
            />
          )}

          {step === "preview" && (
            <StepPreview
              validated={validated}
              skipped={skipped}
              committeeNames={committeeNames}
              onSkipChange={setSkipped}
              onRowUpdate={handleRowUpdate}
              onBack={() => setStep("mapping")}
              onNext={() => goNext()}
            />
          )}

          {step === "commit" && (
            <StepCommit
              validated={validated}
              skipped={skipped}
              committeeNames={committeeNames}
              onBack={goBack}
            />
          )}
        </>
      )}
    </div>
  )
}
