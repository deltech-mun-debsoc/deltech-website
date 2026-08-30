# CI and deployments

Vercel's Git integration deploys. GitHub Actions only runs checks.

```text
pull request     → Validate (Actions) + a Vercel Preview URL
push to main     → Production
```

There is one workflow, `.github/workflows/check.yml`. No workflow deploys, and
none needs a Vercel token.

## Workflows

| Name | Trigger | Purpose |
| --- | --- | --- |
| **CI** | Pull request or manual | `npm run check` and a production build. |

## Deployments

Vercel builds every push. `vercel.json` points `buildCommand` at
`npm run build:vercel`, which is `next build` and nothing else.

**The build does not migrate.** It used to, and that was removed deliberately in
`d476bd2` so a deployment can never alter the schema on its way out. Every
migration is applied by hand, before the deploy that needs it.

The cost of that is a trap this document previously helped set: merging a PR
with a migration in it deploys code that expects a column or an enum value the
database does not have. `20260830120000_quiz_formats_and_avatars` sat unapplied
for a day that way, and every attempt to add a true/false or typed-answer slide
came back `invalid input value for enum "SlideType"`. **Apply the migration
first, then merge.**

## Migrations

Applied by hand. Check first, then run:

```bash
DIRECT_URL='<session pooler, port 5432>' npm run db:deploy
DIRECT_URL='<same>' npx prisma migrate status
```

Use the Supabase SESSION pooler on port 5432. `db.<ref>.supabase.co` is
IPv6-only and unreachable from CI runners, and port 6543 is the transaction
pooler, which cannot run DDL.

There is a window of a few minutes between the migration finishing and the new
deployment being promoted, during which the OLD code runs against the NEW
schema. Additive migrations are unaffected; for a drop or a rename use
expand/contract (add column → deploy → backfill → drop in a later release).

Vercel's Instant Rollback reverts code only. It does not revert the schema.

## Environment variables

Set on the Vercel project, not in this repo. Two rules that have each caused an
outage:

- `NEXT_PUBLIC_*` values are inlined at BUILD time. Changing one requires a
  redeploy; editing it alone does nothing.
- Do not set `AUTH_URL`. Auth.js rewrites every request's origin to match it, so
  any deployment on a different hostname fails with `error=Configuration`.
  `VERCEL=1` already makes `trustHost` true, so each deployment self-names.

`DIRECT_URL` must exist on the Production scope: the build container needs it,
not just the runtime.

## Crons

`vercel.json`, Production deployments only. Vercel does not run crons for
Preview deployments.

## Recruitment checks

The recruitment module keeps its decision logic in pure functions
(`src/lib/recruitment/*`) precisely so it can be asserted without a database:

| Script | Asserts |
| --- | --- |
| `check-recruitment-permissions` | capability matrix and the cycle-state gate |
| `check-recruitment-transitions` | candidate stage and result machines |
| `check-recruitment-session` | timers, idempotency, control leases, staleness |
| `check-recruitment-import` | row identity, idempotency, duplicates, manual-edit protection |
| `check-recruitment-guards` | static analysis: no unguarded action, and the JC withholdings hold |
| `check-media-keys` | S3 object-key construction and upload validation |

`check-recruitment-concurrency.ts` is the exception. It asserts the races the
*database* must refuse (partial unique indexes, the candidate lock, the
append-only audit trigger), so it needs a real writable Postgres. It exits 0
immediately unless `RECRUITMENT_DB_CHECKS=1` is set, which keeps CI green against
a database it must not write to. Run it against a scratch database before
touching the recruitment schema:

```bash
RECRUITMENT_DB_CHECKS=1 DIRECT_URL=postgresql://.../scratch npx tsx scripts/check-recruitment-concurrency.ts
```

## S3 media uploads

Author images, team photos and recruitment documents go to S3 through a
presigned PUT (`src/lib/media/`). Set `S3_BUCKET`, `S3_REGION`,
`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`; see `.env.example`. They are read
lazily, so a build without them succeeds and only uploading is disabled. Never
expose them with a `NEXT_PUBLIC_` prefix: the browser receives a short-lived
signature, never a credential. `/api/cron/media-sweep` deletes abandoned uploads
and is gated by `CRON_SECRET` like the other cron routes.
