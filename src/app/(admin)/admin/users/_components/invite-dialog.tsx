"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { t } from "@/content/strings"
import { inviteStaff } from "../actions"

type Role = "ADMIN" | "MAINTAINER" | "AUTHOR" | "SUB_MAINTAINER"
const ROLE_ITEMS = [
  { value: "MAINTAINER", label: "Maintainer" },
  { value: "ADMIN", label: "Admin" },
  { value: "AUTHOR", label: "Author (blog only)" },
  { value: "SUB_MAINTAINER", label: "Junior Council (recruitment only)" },
]

export function InviteDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("MAINTAINER")
  const [isPending, startTransition] = useTransition()

  const invite = () =>
    startTransition(async () => {
      const result = await inviteStaff(email, role)
      if (result.success) {
        if (result.warning) toast.warning(result.warning)
        else toast.success(`Invited ${email} as ${role}. They'll get an email.`)
        setOpen(false)
        setEmail("")
        setRole("MAINTAINER")
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed to invite.")
      }
    })

  return (
    <>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <UserPlus className="size-3.5" /> Invite staff
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite staff</DialogTitle>
            <DialogDescription>
              Creates their account and emails a link to the staff sign-in. They sign
              in with this email. No password needed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("admin.users.inviteEmailPlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select items={ROLE_ITEMS} value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MAINTAINER">Maintainer</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="AUTHOR">Author (blog only)</SelectItem>
                  <SelectItem value="SUB_MAINTAINER">Junior Council (recruitment only)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={invite} disabled={isPending || !email.trim()}>
              {isPending ? "Inviting…" : "Send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
