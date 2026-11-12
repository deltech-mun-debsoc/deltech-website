import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export default function NotFound() {
  return (
    <div className="grid min-h-svh place-items-center px-4 py-20">
      <div className="editorial-card w-full max-w-md p-8 text-center">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          If you followed a private link, it may have expired.
        </p>
        <div className="rule my-6" />
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
          Back to home
        </Link>
      </div>
    </div>
  )
}
