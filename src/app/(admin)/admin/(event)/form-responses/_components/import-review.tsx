"use client"

import { useState } from "react"
import { ChevronDown, Download, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { t, type StringKey } from "@/content/strings"
import type { Decision, RowResolution } from "@/lib/delegate-import"
import { statusMeta } from "../../registrations/_lib/status"
import type { FormPreviewResult, FormPreviewRow, ResolutionPatch } from "../actions"

type Preview = Extract<FormPreviewResult, { ok: true }>
type CommitteeDecision = Extract<Decision, { kind: "committee" }>

// The review, ordered by what the organiser has to do: decisions first, then
// what will import, then what will not. Every decision is one plain question
// with a few answers; answering re-checks the sheet with it applied.
export function ImportReview({
  preview,
  committees,
  pending,
  onResolve,
  onImport,
}: {
  preview: Preview
  committees: { id: string; name: string }[]
  pending: boolean
  onResolve: (patch: ResolutionPatch) => void
  onImport: () => void
}) {
  const by = (bucket: FormPreviewRow["bucket"]) => preview.rows.filter((r) => r.bucket === bucket)
  const decisions = by("decision")
  const ready = by("ready")
  const warnings = by("warning")
  const skipped = by("skipped")
  const importable = ready.length + warnings.length

  // One question per distinct committee answer, however many rows gave it.
  const committeeQuestions = new Map<string, { decision: CommitteeDecision; rows: FormPreviewRow[] }>()
  for (const row of decisions) {
    for (const d of row.decisions) {
      if (d.kind !== "committee") continue
      const q = committeeQuestions.get(d.key) ?? { decision: d, rows: [] }
      if (!q.rows.includes(row)) q.rows.push(row)
      committeeQuestions.set(d.key, q)
    }
  }
  const rowQuestions = decisions.flatMap((row) => row.decisions.filter((d) => d.kind !== "committee").map((d) => ({ row, d })))
  const setRow = (rowHash: string, value: RowResolution | null) => onResolve({ row: { rowHash, value } })

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h2 className="section-label">{t("admin.formSync.previewTitle")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("admin.formSync.summary", {
            total: preview.rows.length,
            ready: ready.length,
            decision: decisions.length,
            warning: warnings.length,
            skipped: skipped.length,
          })}
        </p>
        {preview.alreadyApplied && <p className="text-sm text-muted-foreground">{t("admin.formSync.alreadyApplied")}</p>}
      </div>

      {(committeeQuestions.size > 0 || rowQuestions.length > 0) && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4 text-amber-600" />
            {t("admin.formSync.decisionTitle", { n: decisions.length })}
          </h3>
          <p className="text-sm text-muted-foreground">{t("admin.formSync.decisionHelp")}</p>
          <ul className="space-y-3">
            {[...committeeQuestions.values()].map(({ decision, rows }) => (
              <CommitteeQuestion key={decision.key} decision={decision} rows={rows} committees={committees} pending={pending} onResolve={onResolve} />
            ))}
            {rowQuestions.map(({ row, d }) => (
              <li key={`${row.rowHash}-${d.kind}`} className="rounded-md border border-border/70 p-4 text-sm">
                <RowQuestion row={row} decision={d} pending={pending} setRow={setRow} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <Group title={t("admin.formSync.warningTitle", { n: warnings.length })} open>
          <p className="text-sm text-muted-foreground">{t("admin.formSync.stillImport")}</p>
          <ul className="divide-y divide-border/60">
            {warnings.map((r) => (
              <li key={r.index} className="py-2 text-sm">
                <p className="font-medium">{`${r.fullName ?? ""} · ${r.email ?? ""}`}</p>
                {r.warnings.map((w, i) => (
                  <p key={i} className="text-muted-foreground">{w}</p>
                ))}
              </li>
            ))}
          </ul>
        </Group>
      )}

      {ready.length > 0 && (
        <Group title={t("admin.formSync.readyTitle", { n: ready.length })} open={decisions.length === 0 && ready.length <= 12}>
          <PeopleTable rows={ready} />
        </Group>
      )}

      {skipped.length > 0 && (
        <Group title={t("admin.formSync.skippedTitle", { n: skipped.length })}>
          <Skipped preview={preview} skipped={skipped} pending={pending} onResolve={onResolve} />
        </Group>
      )}

      <div className="space-y-2">
        <Button size="lg" className="gap-1.5" disabled={pending || importable === 0} onClick={onImport}>
          <Download className="size-4" />
          {pending ? t("admin.formSync.applying") : t("admin.formSync.importN", { n: importable })}
        </Button>
        {decisions.length > 0 && <p className="text-sm text-muted-foreground">{t("admin.formSync.waitingNote", { n: decisions.length })}</p>}
      </div>
    </section>
  )
}

function Group({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="group space-y-3" open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3 space-y-2">{children}</div>
    </details>
  )
}

function PeopleTable({ rows }: { rows: FormPreviewRow[] }) {
  return (
    <div className="max-h-[24rem] overflow-auto rounded-md border border-border/70">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border/70">
            <th className="px-3 py-2 font-medium">{t("admin.formSync.tableRow")}</th>
            <th className="px-3 py-2 font-medium">{t("admin.formSync.tableName")}</th>
            <th className="px-3 py-2 font-medium">{t("admin.formSync.tableEmail")}</th>
            <th className="px-3 py-2 font-medium">{t("admin.formSync.tableChoices")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.index} className="border-b border-border/40 align-top last:border-0">
              {/* +2: sheet rows start at 1 and row 1 is the header, so this is
                  the number the organiser sees in Google Sheets. */}
              <td className="px-3 py-2 text-muted-foreground tabular-nums">{r.index + 2}</td>
              <td className="px-3 py-2">{r.fullName}</td>
              <td className="px-3 py-2">
                <span className="block break-all">{r.email}</span>
                <span className="block text-xs text-muted-foreground">
                  {r.outcome === "update" ? t("admin.formSync.updates", { fields: r.changes.join(", ") }) : t("admin.formSync.newPerson")}
                  {r.protectedFields.length > 0 && ` · ${t("admin.formSync.protectedNote", { fields: r.protectedFields.join(", ") })}`}
                </span>
              </td>
              <td className="px-3 py-2">{r.choices}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CommitteeQuestion({
  decision,
  rows,
  committees,
  pending,
  onResolve,
}: {
  decision: CommitteeDecision
  rows: FormPreviewRow[]
  committees: { id: string; name: string }[]
  pending: boolean
  onResolve: (patch: ResolutionPatch) => void
}) {
  // An ambiguous answer cannot become an alias: it already names two committees.
  const [remember, setRemember] = useState(!decision.ambiguous)
  const [other, setOther] = useState("")
  const choose = (committeeId: string | null) =>
    onResolve({ committee: { key: decision.key, committeeId, ...(remember && committeeId ? { alias: decision.answer } : {}) } })
  const question: StringKey = decision.ambiguous
    ? "admin.formSync.committeeAmbiguous"
    : decision.candidates.length
      ? "admin.formSync.committeeNear"
      : "admin.formSync.committeeUnknown"
  const names = rows.slice(0, 4).map((r) => r.fullName ?? r.email ?? "").join(", ") + (rows.length > 4 ? "…" : "")

  return (
    <li className="space-y-3 rounded-md border border-border/70 p-4 text-sm">
      <p className="font-medium">{t(question, { answer: decision.answer, label: decision.label, n: decision.candidates.length })}</p>
      <p className="text-xs text-muted-foreground">{t("admin.formSync.affected", { n: rows.length, names })}</p>
      <div className="flex flex-wrap items-center gap-2">
        {decision.candidates.map((c) => (
          <Button key={c.id} size="sm" variant="outline" disabled={pending} onClick={() => choose(c.id)}>
            {c.name}
          </Button>
        ))}
        <select
          aria-label={t("admin.formSync.committeePickOther")}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={other}
          disabled={pending}
          onChange={(e) => {
            setOther(e.target.value)
            if (e.target.value) choose(e.target.value)
          }}
        >
          <option value="">{t("admin.formSync.committeePickOther")}</option>
          {committees.filter((c) => !decision.candidates.some((d) => d.id === c.id)).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => choose(null)}>
          {t("admin.formSync.committeeLeaveEmpty")}
        </Button>
      </div>
      {!decision.ambiguous && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t("admin.formSync.committeeRemember", { answer: decision.answer })}
        </label>
      )}
    </li>
  )
}

const SOURCE_KEY: Record<string, StringKey> = {
  SELF: "admin.formSync.sourceLabelSELF",
  CROSS_DEL: "admin.formSync.sourceLabelCROSS_DEL",
  MANUAL: "admin.formSync.sourceLabelMANUAL",
  SPONSORED: "admin.formSync.sourceLabelSPONSORED",
  INTERNAL: "admin.formSync.sourceLabelINTERNAL",
}

function RowQuestion({
  row,
  decision,
  pending,
  setRow,
}: {
  row: FormPreviewRow
  decision: Exclude<Decision, { kind: "committee" }>
  pending: boolean
  setRow: (rowHash: string, value: RowResolution | null) => void
}) {
  const [correcting, setCorrecting] = useState(false)
  const [email, setEmail] = useState("")

  if (decision.kind === "invalid") {
    return (
      <div className="space-y-3">
        <p className="font-medium">{t("admin.formSync.invalidQuestion", { row: row.index + 2, errors: row.errors.join(" ") })}</p>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setRow(row.rowHash, "skip")}>
          {t("admin.formSync.skipResponse")}
        </Button>
      </div>
    )
  }

  if (decision.kind === "possible-duplicate") {
    const others = decision.others
      .map((o) => (o.registered ? t("admin.formSync.duplicateRegistered", { name: o.name ?? o.email }) : `${o.name ?? ""} (${o.email})`))
      .join(", ")
    return (
      <div className="space-y-3">
        <p className="font-medium">
          {t("admin.formSync.duplicateQuestion", { name: `${row.fullName ?? ""} (${row.email ?? ""})`, by: decision.by, value: decision.value, others })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setRow(row.rowHash, "import")}>
            {t("admin.formSync.duplicateDifferent")}
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setRow(row.rowHash, "skip")}>
            {t("admin.formSync.duplicateSame")}
          </Button>
        </div>
      </div>
    )
  }

  // An identity clash: the existing record is shown, never replaced.
  const e = decision.existing
  const source = e.source ? t(SOURCE_KEY[e.source] ?? "admin.formSync.sourceLabelSELF") : ""
  const stage = statusMeta(e.status).label.toLowerCase()
  return (
    <div className="space-y-3">
      <p className="font-medium">
        {e.seat
          ? t("admin.formSync.identityWithSeat", { email: e.email, source, stage, seat: e.seat })
          : t("admin.formSync.identityQuestion", { email: e.email, source, stage })}
      </p>
      <p className="text-xs text-muted-foreground">{`${row.fullName ?? ""} · ${row.choices ?? ""}`}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setRow(row.rowHash, "skip")}>
          {t("admin.formSync.identityKeep")}
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setRow(row.rowHash, "safe-fields")}>
          {t("admin.formSync.identitySafe")}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setCorrecting((c) => !c)}>
          {t("admin.formSync.identityCorrect")}
        </Button>
      </div>
      {correcting && (
        <div className="flex flex-wrap gap-2">
          <Input
            type="email"
            className="h-9 max-w-xs"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            placeholder={t("admin.formSync.identityCorrectPlaceholder")}
          />
          <Button size="sm" disabled={pending || !email.trim()} onClick={() => setRow(row.rowHash, { email })}>
            {t("admin.formSync.identityCorrectSave")}
          </Button>
        </div>
      )}
    </div>
  )
}

function Skipped({
  preview,
  skipped,
  pending,
  onResolve,
}: {
  preview: Preview
  skipped: FormPreviewRow[]
  pending: boolean
  onResolve: (patch: ResolutionPatch) => void
}) {
  const unchanged = skipped.filter((r) => r.outcome === "skip-unchanged").length
  const kept = skipped.filter((r) => r.outcome === "skip-kept" || r.outcome === "invalid")
  return (
    <div className="space-y-4 text-sm">
      {unchanged > 0 && <p className="text-muted-foreground">{t("admin.formSync.unchangedN", { n: unchanged })}</p>}

      {preview.repeats.map((g) => (
        <div key={g.email} className="space-y-2 rounded-md border border-border/70 p-3">
          <p className="font-medium">
            {t("admin.formSync.repeatLine", {
              email: g.email,
              n: g.others.length + 1,
              which: g.latestKept ? t("admin.formSync.repeatLatest") : t("admin.formSync.repeatChosen"),
              when: g.kept.submittedAt ?? t("admin.formSync.duplicateRow", { row: g.kept.index + 2 }),
            })}
          </p>
          {g.others.map((o) => {
            const when = o.submittedAt ?? t("admin.formSync.duplicateRow", { row: o.index + 2 })
            return (
              <div key={o.rowHash} className="space-y-1 border-t border-border/50 pt-2">
                <p className="text-muted-foreground">
                  {o.differences.length ? t("admin.formSync.repeatDiffers", { when }) : t("admin.formSync.repeatSame", { when })}
                </p>
                {o.differences.map((d) => (
                  <p key={d.field} className="text-xs">
                    <span className="text-muted-foreground">{`${d.field}: `}</span>
                    <span className="line-through opacity-60">{d.kept}</span>
                    {" → "}
                    <span>{d.other}</span>
                  </p>
                ))}
                {o.differences.length > 0 && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={pending} onClick={() => onResolve({ keep: { email: g.email, rowHash: o.rowHash } })}>
                    {t("admin.formSync.repeatKeepThis")}
                  </Button>
                )}
              </div>
            )
          })}
          {!g.latestKept && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={pending} onClick={() => onResolve({ keep: { email: g.email, rowHash: null } })}>
              {t("admin.formSync.repeatBackToLatest")}
            </Button>
          )}
        </div>
      ))}

      {kept.length > 0 && (
        <ul className="divide-y divide-border/60">
          {kept.map((r) => (
            <li key={r.index} className="flex items-center justify-between gap-3 py-2">
              <span>
                {`${r.fullName ?? ""} · ${r.email ?? ""}`}
                <span className="block text-xs text-muted-foreground">{r.outcome === "invalid" ? r.errors.join(" ") : t("admin.formSync.keptExisting")}</span>
              </span>
              <Button size="sm" variant="ghost" className="text-xs" disabled={pending} onClick={() => onResolve({ row: { rowHash: r.rowHash, value: null } })}>
                {t("admin.formSync.undo")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
