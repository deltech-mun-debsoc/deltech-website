// Local to the recruitment area on purpose: the admin PageHeader carries the
// dashboard's eyebrow styling and lives in (admin)/_components, and this area is
// meant to stand alone.
export function RecruitmentPageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/70 pb-5">
      <div className="min-w-0">
        {eyebrow && (
          <p className="eyebrow">
            {eyebrow}
          </p>
        )}
        <h1 className="display mt-1 text-2xl leading-tight sm:text-3xl">{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}
