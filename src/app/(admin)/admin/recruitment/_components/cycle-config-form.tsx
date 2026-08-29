"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { t } from "@/content/strings"
import type { EvaluationCriterion, RecruitmentCycleConfig } from "@/lib/schemas/recruitment"
import { updateCycleConfig } from "../actions"

// Stage rules and the GD/PI rubrics. Selected candidates are always added as
// members; author onboarding is a separate concern and needs no configuration.
export function CycleConfigForm({
  cycleId,
  version,
  config: initial,
  disabled,
}: {
  cycleId: string
  version: number
  config: RecruitmentCycleConfig
  disabled: boolean
}) {
  const router = useRouter()
  const [config, setConfig] = useState(initial)
  const [pending, startTransition] = useTransition()

  const setStages = (patch: Partial<RecruitmentCycleConfig["stages"]>) =>
    setConfig((c) => ({ ...c, stages: { ...c.stages, ...patch } }))

  const setCriteria = (key: "gdCriteria" | "piCriteria", next: EvaluationCriterion[]) =>
    setConfig((c) => ({ ...c, [key]: next }))

  function save() {
    startTransition(async () => {
      const result = await updateCycleConfig({ cycleId, config, expectedVersion: version })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(t("recruitment.control.saveConfig"))
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* ---- Stage rules ---- */}
      <Card className="space-y-4 p-4">
        <h2 className="section-label">
          {t("recruitment.control.stagesTitle")}
        </h2>

        <div className="space-y-3">
          <ToggleRow
            id="gd-default"
            label={t("recruitment.control.gdRequiredDefault")}
            checked={config.stages.gdRequiredByDefault}
            disabled={disabled}
            onChange={(v) => setStages({ gdRequiredByDefault: v })}
          />
          <ToggleRow
            id="pi-default"
            label={t("recruitment.control.piRequiredDefault")}
            checked={config.stages.piRequiredByDefault}
            disabled={disabled}
            onChange={(v) => setStages({ piRequiredByDefault: v })}
          />
          <ToggleRow
            id="allow-bypass"
            label={t("recruitment.control.allowBypass")}
            checked={config.stages.allowGdBypass}
            disabled={disabled}
            onChange={(v) => setStages({ allowGdBypass: v })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="gd-planned" className="text-xs">
              {t("recruitment.control.gdPlanned")}
            </Label>
            <Input
              id="gd-planned"
              type="number"
              min={1}
              max={240}
              disabled={disabled}
              value={Math.round(config.stages.gdPlannedSeconds / 60)}
              onChange={(e) =>
                setStages({ gdPlannedSeconds: Math.max(60, Number(e.target.value) * 60) })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pi-planned" className="text-xs">
              {t("recruitment.control.piPlanned")}
            </Label>
            <Input
              id="pi-planned"
              type="number"
              min={1}
              max={240}
              disabled={disabled}
              value={Math.round(config.stages.piPlannedSeconds / 60)}
              onChange={(e) =>
                setStages({ piPlannedSeconds: Math.max(60, Number(e.target.value) * 60) })
              }
            />
          </div>
        </div>
      </Card>

      {/* ---- Rubrics ---- */}
      <Card className="space-y-5 p-4">
        <h2 className="section-label">
          {t("recruitment.control.rubricTitle")}
        </h2>

        <CriteriaEditor
          title={t("recruitment.control.rubricGd")}
          criteria={config.gdCriteria}
          disabled={disabled}
          onChange={(next) => setCriteria("gdCriteria", next)}
        />
        <CriteriaEditor
          title={t("recruitment.control.rubricPi")}
          criteria={config.piCriteria}
          disabled={disabled}
          onChange={(next) => setCriteria("piCriteria", next)}
        />
      </Card>

      <Button onClick={save} disabled={disabled || pending}>
        {t("recruitment.control.saveConfig")}
      </Button>
    </div>
  )
}

function ToggleRow({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  )
}

function CriteriaEditor({
  title,
  criteria,
  disabled,
  onChange,
}: {
  title: string
  criteria: EvaluationCriterion[]
  disabled: boolean
  onChange: (next: EvaluationCriterion[]) => void
}) {
  const update = (index: number, patch: Partial<EvaluationCriterion>) =>
    onChange(criteria.map((c, i) => (i === index ? { ...c, ...patch } : c)))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          disabled={disabled || criteria.length >= 12}
          onClick={() =>
            onChange([
              ...criteria,
              // A machine key derived from the position, so the label stays editable
              // without breaking already-recorded scores keyed on it.
              { key: `criterion_${criteria.length + 1}`, label: "", max: 10, weight: 1 },
            ])
          }
        >
          <Plus className="size-3.5" />
          {t("common.apply")}
        </Button>
      </div>

      <ul className="space-y-2">
        {criteria.map((c, i) => (
          <li key={c.key} className="grid grid-cols-[1fr_5rem_5rem_2rem] items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor={`crit-${c.key}`} className="text-xs">
                {t("recruitment.control.criterionLabel")}
              </Label>
              <Input
                id={`crit-${c.key}`}
                value={c.label}
                disabled={disabled}
                onChange={(e) => update(i, { label: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("recruitment.control.criterionMax")}</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={c.max}
                disabled={disabled}
                onChange={(e) => update(i, { max: Math.max(1, Number(e.target.value)) })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("recruitment.control.criterionWeight")}</Label>
              <Input
                type="number"
                min={0}
                max={10}
                step="0.5"
                value={c.weight}
                disabled={disabled}
                onChange={(e) => update(i, { weight: Math.max(0, Number(e.target.value)) })}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("common.delete")}
              disabled={disabled || criteria.length <= 1}
              onClick={() => onChange(criteria.filter((_, idx) => idx !== i))}
            >
              <X className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
