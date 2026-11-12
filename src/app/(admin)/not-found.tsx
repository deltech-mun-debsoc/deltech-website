import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Without this, notFound() from admin/checkin/[token], admin/blog/[id] and
// admin/quiz/[id] fell through to the marketing 404: staff lost the sidebar
// entirely and the only button sent them to the public homepage. A volunteer
// scanning a bad QR at the check-in desk had to retype /admin/checkin by hand.
export default function AdminNotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <p className="text-xs font-semibold text-muted-foreground">
          Error / 404
        </p>
        <h1 className="mt-3 font-heading text-2xl">Not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          That record does not exist. A scanned code may be from another event, or the record was
          removed since the link was made.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/admin" className={cn(buttonVariants({ variant: "outline" }))}>
            Back to dashboard
          </Link>
          <Link href="/admin/checkin" className={cn(buttonVariants({ variant: "ghost" }))}>
            Check-in desk
          </Link>
        </div>
      </div>
    </div>
  )
}
