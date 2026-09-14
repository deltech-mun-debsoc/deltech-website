"use client"

import { useRef, useState, useTransition } from "react"
import { Upload, FileSpreadsheet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { parseUpload } from "../actions"

interface Props {
  onParsed: (
    headers: string[],
    rows: Record<string, string>[],
    defaultInstitution: string,
  ) => void
}

export function StepUpload({ onParsed }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file,        setFile]        = useState<File | null>(null)
  const [institution, setInstitution] = useState("")
  const [drag,        setDrag]        = useState(false)
  const [pending,     startTransition] = useTransition()

  const handleFile = (f: File) => setFile(f)

  const handleParse = () => {
    if (!file) return
    startTransition(async () => {
      const fd = new FormData()
      fd.append("file", file)
      const result = await parseUpload(fd)
      if (!result.success || !result.headers || !result.rows) {
        toast.error(result.error ?? "Failed to parse file.")
        return
      }
      onParsed(result.headers, result.rows, institution.trim())
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card p-8 space-y-6">
      {/* Institution pre-fill */}
      <div className="space-y-1.5">
        <Label htmlFor="institution" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Institution (applies to all rows with no institution column)
        </Label>
        <Input
          id="institution"
          placeholder="e.g. Amity University, Noida"
          className="h-9 text-sm"
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
        />
      </div>

      {/* File drop zone */}
      <div
        role="button"
        tabIndex={0}
        className={`flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-14 text-center transition-colors cursor-pointer
          ${drag ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          const f = e.dataTransfer.files[0]
          if (f) handleFile(f)
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      >
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
          <Upload className="size-6 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">
            {file ? file.name : "Drop your partner sheet here"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {file
              ? `${(file.size / 1024).toFixed(1)} KB, click to change`
              : ".xlsx, .xls, or .csv, any column order, any formatting"}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
      </div>

      {file && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <FileSpreadsheet className="size-5 shrink-0 text-primary" />
          <span className="flex-1 truncate text-sm text-foreground">{file.name}</span>
          <Button size="sm" onClick={handleParse} disabled={pending}>
            {pending ? "Parsing…" : "Analyse with AI →"}
          </Button>
        </div>
      )}
    </div>
  )
}
