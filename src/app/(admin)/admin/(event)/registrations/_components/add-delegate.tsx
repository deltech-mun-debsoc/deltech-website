"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { UserPlus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toSelectItems } from "@/lib/utils"
import { addDelegate } from "../actions"

interface Props {
  committees: { id: string; name: string }[]
  intra: boolean
}

const EMPTY = { fullName: "", email: "", whatsapp: "", rollNumber: "", institution: "", isDtu: false, pref1CommitteeId: "", pref1Portfolio: "" }

export function AddDelegate({ committees, intra }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [pending, startTransition] = useTransition()
  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) => setForm((f) => ({ ...f, [key]: value }))
  const committeeItems = [{ value: "", label: "Not decided" }, ...toSelectItems(committees, (c) => c.id, (c) => c.name)]

  // Both buttons submit the form, so the browser stops on an empty required field
  // and points at it before anything is sent, whichever button was pressed.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const thenSeat = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "seat"
    startTransition(async () => {
      const r = await addDelegate(form)
      if (!r.success) {
        toast.error(r.error)
        return
      }
      toast.success(`${form.fullName} added. Their application link is on its way by email.`)
      setForm(EMPTY)
      setOpen(false)
      if (thenSeat) router.push(`/admin/allotment?delegate=${r.id}`)
      else router.refresh()
    })
  }

  return (
    <>
      <Button className="gap-1.5" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" /> Add delegate
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a delegate</DialogTitle>
            <DialogDescription>
              For someone registering on the spot, even while public registration is closed. Everything is needed unless it says optional.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={onSubmit}>
            <Field label="Full name">
              <Input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} autoFocus required minLength={2} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
              </Field>
              <Field label="WhatsApp number">
                <Input type="tel" value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} required minLength={7} placeholder="98xxxxxxxx" />
              </Field>
            </div>
            {intra ? (
              <Field label="DTU roll number">
                <Input value={form.rollNumber} onChange={(e) => set("rollNumber", e.target.value)} placeholder="2K23/CO/123" required />
              </Field>
            ) : (
              <div className="space-y-3">
                <Field label="College">
                  <Input
                    value={form.isDtu ? "Delhi Technological University" : form.institution}
                    onChange={(e) => set("institution", e.target.value)}
                    disabled={form.isDtu}
                    required={!form.isDtu}
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={form.isDtu} onChange={(e) => set("isDtu", e.target.checked)} />
                  DTU student
                </label>
              </div>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Committee they want" optional>
                <Select items={committeeItems} value={form.pref1CommitteeId || undefined} onValueChange={(v) => set("pref1CommitteeId", v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Not decided" />
                  </SelectTrigger>
                  <SelectContent>
                    {committeeItems.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Portfolio they want" optional>
                <Input
                  value={form.pref1Portfolio}
                  onChange={(e) => set("pref1Portfolio", e.target.value)}
                  disabled={!form.pref1CommitteeId}
                  placeholder={form.pref1CommitteeId ? "e.g. India" : "Pick a committee first"}
                />
              </Field>
            </div>
            <DialogFooter>
              <Button type="submit" name="then" value="list" variant="outline" disabled={pending}>
                Just add
              </Button>
              <Button type="submit" name="then" value="seat" disabled={pending}>
                {pending ? "Adding…" : "Add and give a seat"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm">
        {label}
        {optional && <span className="text-xs font-normal text-muted-foreground">optional</span>}
      </Label>
      {children}
    </div>
  )
}
