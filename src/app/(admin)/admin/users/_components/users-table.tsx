"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { MoreHorizontal, Ban, RotateCcw, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { setUserRole, setUserDisabled, deleteUser } from "../actions"

interface UserRow {
  id: string
  email: string
  name: string | null
  role: string
  disabledAt: Date | string | null
}

const ROLE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ADMIN: "default",
  MAINTAINER: "outline",
  AUTHOR: "secondary",
  REGISTERER: "secondary",
}

export function UsersTable({ users, selfEmail }: { users: UserRow[]; selfEmail: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null)

  const run = (fn: () => Promise<{ success: boolean; error?: string }>, ok: string) =>
    startTransition(async () => {
      const result = await fn()
      if (result.success) {
        toast.success(ok)
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed.")
      }
    })

  const changeRole = (userId: string, role: string) =>
    run(() => setUserRole(userId, role as never), "Role updated.")

  const toggleDisabled = (u: UserRow) =>
    run(
      () => setUserDisabled(u.id, !u.disabledAt),
      u.disabledAt ? "Access restored." : "Access revoked.",
    )

  const remove = (u: UserRow) => {
    setConfirmDelete(null)
    run(() => deleteUser(u.id), "User deleted.")
  }

  return (
    <>
      <div className="editorial-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3 text-right">Change</th>
              <th className="w-px px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.email === selfEmail
              const disabled = !!u.disabledAt
              return (
                <tr
                  key={u.id}
                  className={`border-b border-border/60 last:border-0 ${disabled ? "opacity-55" : ""}`}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium">{u.name ?? u.email}</p>
                    {u.name && <p className="text-xs text-muted-foreground">{u.email}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={ROLE_VARIANT[u.role] ?? "secondary"}>{u.role}</Badge>
                    {disabled && (
                      <Badge variant="destructive" className="ml-2">
                        Disabled
                      </Badge>
                    )}
                    {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <Select
                        value={u.role}
                        onValueChange={(v) => v && v !== u.role && changeRole(u.id, v)}
                        disabled={isSelf || disabled || isPending}
                      >
                        <SelectTrigger className="h-8 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ADMIN">Admin</SelectItem>
                          <SelectItem value="MAINTAINER">Maintainer</SelectItem>
                          <SelectItem value="AUTHOR">Author</SelectItem>
                          <SelectItem value="SUB_MAINTAINER">Junior Council</SelectItem>
                          <SelectItem value="CHAIR">Committee chair</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        disabled={isSelf || isPending}
                        aria-label={`Actions for ${u.email}`}
                        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem className="gap-2" onClick={() => toggleDisabled(u)}>
                          {disabled ? (
                            <>
                              <RotateCcw className="size-3.5" /> Restore access
                            </>
                          ) : (
                            <>
                              <Ban className="size-3.5" /> Disable access
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          className="gap-2"
                          onClick={() => setConfirmDelete(u)}
                        >
                          <Trash2 className="size-3.5" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this user?</DialogTitle>
            <DialogDescription>
              {confirmDelete?.email} will be removed permanently, along with their sign-in
              sessions. This cannot be undone. If they wrote anything, delete will be refused
              and you should disable the account instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => confirmDelete && remove(confirmDelete)}
            >
              Delete user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
