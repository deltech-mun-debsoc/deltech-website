"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { Sparkles, Loader2 } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  applyMapping,
  mappedRowSchema,
  type ColumnMapping,
  type MappedRow,
  type ValidatedRow,
} from "@/lib/schemas/import"
import type { ImportPresetRecord, CommitResult } from "../actions"
import { suggestMappingWithGemini, cleanImportRowsWithGemini } from "../actions-ai"
import { StepUpload } from "./step-upload"
import { StepMapping } from "./step-mapping"
import { StepPreview } from "./step-preview"
import { StepCommit } from "./step-commit"

export type WizardStep = "upload" | "mapping" | "preview" | "commit" | "done"

const STEPS: { key: WizardStep; label: string }[] = [
  { key: "upload",  label: "Upload"      },
  { key: "mapping", label: "Map columns" },
  { key: "preview", label: "Preview"     },
  { key: "commit",  label: "Import"      },
]

interface Props {
  presets:        ImportPresetRecord[]
  committeeNames: string[]
}

export function ImportWizard({ presets: initialPresets, committeeNames }: Props) {
  const [step,               setStep]               = useState<WizardStep>("upload")
  const [headers,            setHeaders]            = useState<string[]>([])
  const [rawRows,            setRawRows]            = useState<Record<string, string>[]>([])
  const [mapping,            setMapping]            = useState<ColumnMapping>({})
  const [validated,          setValidated]          = useState<ValidatedRow[]>([])
  const [skipped,            setSkipped]            = useState<Set<number>>(new Set())
  const [defaultInstitution, setDefaultInstitution] = useState("")
  const [presets,            setPresets]            = useState(initialPresets)
  // Lifted out of StepCommit so the terminal screen can link to quarantine.
  const [result,             setResult]             = useState<CommitResult | null>(null)

  const [aiProcessing, startAiProcess] = useTransition()

  const displayStep  = aiProcessing ? "mapping" : step
  const currentIndex = STEPS.findIndex((s) => s.key === displayStep)

  // ── After file is parsed, auto-run AI pipeline ────────────────────────────
  const handleParsed = (
    parsedHeaders: string[],
    parsedRows: Record<string, string>[],
    institution: string,
  ) => {
    setHeaders(parsedHeaders)
    setRawRows(parsedRows)
    setDefaultInstitution(institution)
    setMapping({})
    setValidated([])
    setSkipped(new Set())

    startAiProcess(async () => {
      try {
        // Step 1: auto-detect column mapping
        const mapResult = await suggestMappingWithGemini(parsedHeaders, parsedRows.slice(0, 5))

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

        // Auto-skip rows the AI flagged as noise
        const autoSkipped = new Set<number>()
        const validatedRows: ValidatedRow[] = cleanResult.cleaned.map(({ _note, _skip, ...mapped }, i) => {
          const parse  = mappedRowSchema.safeParse(mapped)
          const errors = parse.success ? [] : parse.error.issues.map((e) => e.message)
          if (_skip) autoSkipped.add(i)
          return { index: i, raw: parsedRows[i], mapped, errors, aiNote: _note }
        })

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

  const reset = () => {
    setStep("upload")
    setHeaders([])
    setRawRows([])
    setMapping({})
    setValidated([])
    setSkipped(new Set())
    setDefaultInstitution("")
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
                setSkipped(new Set())
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
              onBack={goBack}
              onDone={(r) => { setResult(r); setStep("done") }}
            />
          )}

          {step === "done" && (
            <div className="rounded-xl border border-border bg-card p-10 text-center">
              <p className="text-2xl font-bold text-foreground">Import complete</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Delegates have been created and appear in the registrations table.
              </p>
              {/* This screen used to name the registrations table and the
                  quarantine without linking to either, so the only way on was
                  to reset the wizard. */}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/admin/registrations"
                  className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  View registrations
                </Link>
                {result && result.quarantined > 0 && (
                  <Link
                    href="/admin/import#quarantine"
                    className="rounded-md border border-amber-500/50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-400"
                  >
                    Review {result.quarantined} quarantined row
                    {result.quarantined === 1 ? "" : "s"}
                  </Link>
                )}
                <button
                  className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                  onClick={reset}
                >
                  Start another import
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
