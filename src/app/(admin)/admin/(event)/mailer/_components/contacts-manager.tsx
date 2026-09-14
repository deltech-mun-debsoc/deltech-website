"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatDate } from "@/lib/datetime"
import { parseUpload } from "@/app/(admin)/admin/(event)/import/actions"
import { addContacts, removeContact, setPrMailEnabled } from "../actions"

interface ContactRow {
  id: string
  email: string
  name: string | null
  institution: string | null
  tags: string[]
  unsubscribedAt: string | null
  bouncedAt: string | null
  lastMailedAt: string | null
}

// "email, name, institution" per line. Commas inside a name are not supported;
// a CSV upload handles those properly.
function parsePasted(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [email = "", name = "", institution = ""] = line.split(",").map((p) => p.trim())
      return { email, name, institution }
    })
}

function pick(row: Record<string, string>, ...names: string[]): string {
  const key = Object.keys(row).find((k) => names.includes(k.trim().toLowerCase()))
  return key ? row[key] : ""
}

export function ContactsManager({
  contacts,
  prOn,
  isAdmin,
  transport,
  q,
}: {
  contacts: ContactRow[]
  prOn: boolean
  isAdmin: boolean
  transport: string
  q: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [pasted, setPasted] = useState("")
  const [tags, setTags] = useState("")
  const [source, setSource] = useState("")
  const [search, setSearch] = useState(q)
  const [removing, setRemoving] = useState<ContactRow | null>(null)
  const [prConfirm, setPrConfirm] = useState(false)

  const tagList = () => tags.split(",").map((t) => t.trim()).filter(Boolean)

  const importRows = (rows: { email: string; name?: string; institution?: string }[]) =>
    startTransition(async () => {
      const r = await addContacts(rows, tagList(), source)
      if (!r.success) {
        toast.error(r.error)
        return
      }
      toast.success(`${r.added} added, ${r.updated} already on the list${r.invalid ? `, ${r.invalid} invalid skipped` : ""}.`)
      setPasted("")
      router.refresh()
    })

  const upload = (file: File) =>
    startTransition(async () => {
      const fd = new FormData()
      fd.set("file", file)
      const parsed = await parseUpload(fd)
      if (!parsed.success) {
        toast.error(parsed.error ?? "Could not read that file.")
        return
      }
      const rows = (parsed.rows ?? []).map((row) => ({
        email: pick(row, "email", "email address", "e-mail"),
        name: pick(row, "name", "full name"),
        institution: pick(row, "institution", "college", "school", "university"),
      }))
      const r = await addContacts(rows, tagList(), source || file.name)
      if (!r.success) {
        toast.error(r.error)
        return
      }
      toast.success(`${r.added} added, ${r.updated} already on the list${r.invalid ? `, ${r.invalid} without a valid email skipped` : ""}.`)
      router.refresh()
    })

  return (
    <div className="space-y-8">
      <section className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">PR mail {prOn ? "is on" : "is off"}</p>
            <p className="text-xs text-muted-foreground">Drafts and test sends work either way. Campaigns to this list only go out while it is on.</p>
          </div>
          {isAdmin && <Switch checked={prOn} disabled={pending} onCheckedChange={(v) => (v ? setPrConfirm(true) : startTransition(async () => { await setPrMailEnabled(false); router.refresh() }))} />}
        </div>
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {transport === "ses"
            ? "Mail goes out through Amazon SES. The production access request described transactional mail only, so update that case before sending PR at volume, or the account can be paused."
            : "Mail goes out through Resend's free plan, which allows 100 emails a day across the whole site. PR campaigns will trickle out at that rate."}
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <Label htmlFor="contacts-paste">Paste contacts</Label>
          <Textarea id="contacts-paste" value={pasted} onChange={(e) => setPasted(e.target.value)} rows={6} placeholder="email, name, institution" className="font-mono text-sm" />
          <Button disabled={pending || !pasted.trim()} onClick={() => importRows(parsePasted(pasted))}>Add to the list</Button>
        </div>
        <div className="space-y-3">
          <Label htmlFor="contacts-file">Or upload a CSV or Excel sheet</Label>
          <Input id="contacts-file" type="file" accept=".csv,.xlsx,.xls" disabled={pending} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <p className="text-xs text-muted-foreground">Columns named email, name and institution are picked up.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contacts-tags">Tags for this import</Label>
              <Input id="contacts-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="past delegates, dtu" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contacts-source">Where they came from</Label>
              <Input id="contacts-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="DelTech MUN 2025 sign-up" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Only add people who agreed to hear from the society. Anyone who unsubscribed stays unsubscribed, however often they are imported.</p>
        </div>
      </section>

      <section className="space-y-3">
        <form onSubmit={(e) => { e.preventDefault(); router.push(`/admin/outreach/contacts${search ? `?q=${encodeURIComponent(search)}` : ""}`) }} className="flex gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by email or name" className="max-w-sm" />
          <Button type="submit" variant="outline">Search</Button>
        </form>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Tags</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-t border-border/60">
                  <td className="px-3 py-2"><span className="font-medium">{c.name ?? c.email}</span><span className="block text-xs text-muted-foreground">{c.email}{c.institution ? ` · ${c.institution}` : ""}</span></td>
                  <td className="px-3 py-2 text-xs">{c.tags.join(", ")}</td>
                  <td className="px-3 py-2 text-xs">
                    {c.unsubscribedAt ? <span className="text-destructive">{`Unsubscribed ${formatDate(c.unsubscribedAt)}`}</span> : c.bouncedAt ? <span className="text-destructive">Bounced</span> : c.lastMailedAt ? `Last mailed ${formatDate(c.lastMailedAt)}` : "Not mailed yet"}
                  </td>
                  <td className="px-3 py-2 text-right">{isAdmin && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRemoving(c)}>Remove</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={"Remove this contact?"}
        description={removing ? `${removing.email} is deleted from the list. If they unsubscribed, re-importing them later would lose that record, so keep unsubscribed contacts instead.` : ""}
        confirmLabel={"Remove"}
        destructive
        pending={pending}
        onConfirm={() => removing && startTransition(async () => { await removeContact(removing.id); setRemoving(null); router.refresh() })}
      />
      <ConfirmDialog
        open={prConfirm}
        onOpenChange={setPrConfirm}
        title={"Switch PR mail on?"}
        description={"Scheduled campaigns to the outreach list start sending. Make sure everyone on the list agreed to hear from the society."}
        confirmLabel={"Switch on"}
        pending={pending}
        onConfirm={() => startTransition(async () => { await setPrMailEnabled(true); setPrConfirm(false); router.refresh() })}
      />
    </div>
  )
}
