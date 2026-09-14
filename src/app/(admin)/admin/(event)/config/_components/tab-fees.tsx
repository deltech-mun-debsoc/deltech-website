"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Trash2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { createFee, updateFee, deleteFee } from "../actions"
import type { ClientFee } from "../_lib/types"

interface FeeRow extends ClientFee {
  dirty: boolean
}

interface NewRow {
  label: string
  committeeType: string
  isDtu: boolean
  amountInr: string
}

interface Props {
  fees: ClientFee[]
}

export function TabFees({ fees }: Props) {
  const router = useRouter()
  const [rows, setRows] = useState<FeeRow[]>(() =>
    fees.map((f) => ({ ...f, dirty: false })),
  )
  const [newRow, setNewRow] = useState<NewRow>({
    label: "",
    committeeType: "STANDARD",
    isDtu: false,
    amountInr: "",
  })
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Sync rows from server after refresh
  const [prevFees, setPrevFees] = useState(fees)
  if (fees !== prevFees) {
    setPrevFees(fees)
    setRows(fees.map((f) => ({ ...f, dirty: false })))
  }

  const updateRow = (id: string, patch: Partial<Omit<FeeRow, "id">>) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch, dirty: true } : r)),
    )
  }

  const handleSave = (row: FeeRow) => {
    setPendingId(row.id)
    startTransition(async () => {
      const result = await updateFee(row.id, {
        label: row.label,
        committeeType: row.committeeType,
        isDtu: row.isDtu,
        amountInr: row.amountInr,
      })
      setPendingId(null)
      if (result.success) {
        toast.success("Fee saved.")
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, dirty: false } : r)),
        )
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed.")
      }
    })
  }

  const handleDelete = (id: string) => {
    setPendingId(id)
    startTransition(async () => {
      const result = await deleteFee(id)
      setPendingId(null)
      if (result.success) {
        toast.success("Fee deleted.")
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed.")
      }
    })
  }

  const handleCreate = () => {
    const amount = parseInt(newRow.amountInr, 10)
    if (!newRow.label.trim() || isNaN(amount) || amount < 0) {
      toast.error("Label and a valid amount are required.")
      return
    }
    startTransition(async () => {
      const result = await createFee({
        label: newRow.label.trim(),
        committeeType: newRow.committeeType,
        isDtu: newRow.isDtu,
        amountInr: amount,
      })
      if (result.success) {
        toast.success("Fee created.")
        setNewRow({ label: "", committeeType: "STANDARD", isDtu: false, amountInr: "" })
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed.")
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60">
              {["Label", "Committee type", "DTU?", "Amount (₹)", ""].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No fee rows yet. Add one below.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={row.dirty ? "bg-amber-500/5" : ""}
                >
                  <td className="px-4 py-2">
                    <Input
                      value={row.label}
                      onChange={(e) => updateRow(row.id, { label: e.target.value })}
                      className="h-8 w-44 text-xs"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Select
                      value={row.committeeType}
                      onValueChange={(v) => updateRow(row.id, { committeeType: v ?? row.committeeType })}
                    >
                      <SelectTrigger className="h-8 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="STANDARD">Standard</SelectItem>
                        <SelectItem value="CRISIS">Crisis</SelectItem>
                        <SelectItem value="PRESS">Press</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-2">
                    <Checkbox
                      checked={row.isDtu}
                      onCheckedChange={(checked) =>
                        updateRow(row.id, { isDtu: !!checked })
                      }
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      value={row.amountInr}
                      onChange={(e) =>
                        updateRow(row.id, {
                          amountInr: parseInt(e.target.value) || 0,
                        })
                      }
                      type="number"
                      min={0}
                      className="h-8 w-28 text-xs"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      {row.dirty && (
                        <Button
                          variant="default"
                          size="sm"
                          className="h-7 gap-1 text-xs"
                          onClick={() => handleSave(row)}
                          disabled={pendingId === row.id}
                        >
                          <Save className="size-3" /> Save
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(row.id)}
                        disabled={pendingId === row.id}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Separator />

      {/* Add new fee row */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          Add fee row
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Label</Label>
            <Input
              value={newRow.label}
              onChange={(e) => setNewRow((p) => ({ ...p, label: e.target.value }))}
              placeholder="e.g. Standard – DTU"
              className="h-8 w-48 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select
              value={newRow.committeeType}
              onValueChange={(v) => setNewRow((p) => ({ ...p, committeeType: v ?? "STANDARD" }))}
            >
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STANDARD">Standard</SelectItem>
                <SelectItem value="CRISIS">Crisis</SelectItem>
                <SelectItem value="PRESS">Press</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Amount (₹)</Label>
            <Input
              value={newRow.amountInr}
              onChange={(e) => setNewRow((p) => ({ ...p, amountInr: e.target.value }))}
              type="number"
              min={0}
              placeholder="1200"
              className="h-8 w-28 text-xs"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 pb-0.5 text-sm">
            <Checkbox
              checked={newRow.isDtu}
              onCheckedChange={(checked) =>
                setNewRow((p) => ({ ...p, isDtu: !!checked }))
              }
            />
            DTU student
          </label>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={isPending}
            className="h-8 gap-1.5"
          >
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
      </div>
    </div>
  )
}
