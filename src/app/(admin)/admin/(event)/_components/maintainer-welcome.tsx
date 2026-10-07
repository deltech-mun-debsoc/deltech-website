import Link from "next/link"
import { ArrowRight, ShieldCheck } from "lucide-react"

export function MaintainerWelcome() {
  return (
    <section className="relative overflow-hidden bg-primary p-7 text-primary-foreground sm:p-9">
      <div className="relative grid gap-8 lg:grid-cols-[1fr_0.7fr] lg:items-end">
        <div>
          <p className="data-label flex items-center gap-2 text-gold-300">
            <ShieldCheck className="size-4" /> Maintainer access
          </p>
          <h2 className="mt-4 text-2xl font-semibold">You can run events, delegates, allotment and content.</h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-primary-foreground/72">
            Deletions, payment overrides, revoking a seat and changing roles need an admin.
          </p>
        </div>
        <Link href="/admin/guide" className="inline-flex min-h-12 items-center justify-between gap-4 border border-primary-foreground/30 px-5 py-3 font-semibold transition-colors hover:bg-primary-foreground hover:text-primary">
          Open the operator guide <ArrowRight className="size-5" />
        </Link>
      </div>
    </section>
  )
}
