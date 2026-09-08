# Staging — test.deltechmun.in

A second, complete copy of the site that shares nothing with production. Break
whatever you like here.

```text
test.deltechmun.in   staging branch   staging Supabase project   test-mode keys
www.deltechmun.in    main branch      production Supabase        live keys
```

## For someone new to the team

1. Go to **https://test.deltechmun.in**
2. Sign in with one of the accounts below, using the shared staging password
   (ask whoever set you up).
3. Do anything. Approve, reject, delete, send, import, export. It is a sandbox.

| Sign in as | Role | What you get |
| --- | --- | --- |
| `staging+jc@deltechmun.in` | Junior Council | `/recruitment` — form GD panels, run sessions, score candidates |
| `staging+maintainer@deltechmun.in` | Senior Council | the above, plus interviews and final results |
| `staging+admin@deltechmun.in` | Admin | everything, including `/admin` |
| `staging+registerer@deltechmun.in` | Delegate | the delegate dashboard |
| `staging+author@deltechmun.in` | Author | `/write`, the blog editor |

Every page carries a **Preview** badge in its header. If you cannot see that
badge, stop — you are on production.

### If you break it beyond repair

Say so. One command restores a clean, fully-populated world:

```bash
npm run staging:refresh
```

Nothing you can do in the browser is unrecoverable, so do not be careful.

## What is actually separate

Staging is the same code, deployed twice, reading a different set of
credentials. Vercel scopes environment variables to **Production** or
**Preview**; `main` reads the first, `staging` reads the second.

| | Production | Staging |
| --- | --- | --- |
| Database | production Supabase | its own Supabase project |
| Email | sends to the real recipient | redirected to one sink inbox, subject prefixed `[STAGING → …]` |
| Payments | live Razorpay keys | test-mode keys, no real money |
| Cron secret | production value | its own — staging cannot trigger production's mailout |
| Cron jobs | run daily | **never run** (Vercel does not schedule crons on Preview) |
| Google Sheet | the real public sheet | empty by default, so the sync is a no-op |

Email is deliberately still live, so you can test deliverability. It cannot
reach a delegate: `EMAIL_REDIRECT_TO` sends every message to one inbox instead.
**If that variable is ever unset, staging starts mailing real people.**

## For maintainers

### Making a change

```text
feature branch → PR            CI runs. No deploy.
merge to staging               deploys test.deltechmun.in, migrations auto-applied
                               ↓ try it, break it, confirm it
merge staging → main           deploys production
                               ↓ then apply the migration by hand
```

Production migrations stay manual on purpose — see [CI.md](CI.md).

### The commands

| Command | What it does |
| --- | --- |
| `npm run staging:migrate` | Applies pending migrations to the staging database |
| `npm run staging:refresh` | **Destructive.** Wipes and re-seeds staging with fresh fixtures |
| `npm run staging:sandbox-sheet <url>` | Builds a scrubbed import fixture from a real sheet |

All three read `.env.staging.local`, which is gitignored and never committed.

> If a connection fails with a nonsense hostname like `` `%zfdG9:5432` ``, the
> password contains characters that must be percent-encoded (`@ % / # ?`).
> Either encode them or choose a password of letters and digits only.

### Why the seed refuses to run

`prisma/seed-staging.ts` truncates about twenty tables, so it checks four things
before doing anything:

1. `ALLOW_DESTRUCTIVE_SEED=1` is set
2. `DATABASE_URL` is set
3. `DATABASE_URL` does **not** contain the production project ref
4. `DATABASE_URL` **does** contain `STAGING_DB_REF`

(3) is a blocklist and (4) is an allowlist. (4) is the one that matters: without
it, a mistyped URL pointing at a colleague's database passes every other check,
because that database simply is not production.

`scripts/check-staging-isolation.ts` fails CI if any of those guards is removed.

### The sandbox sheet

Interns need a realistic sheet to import from — real forms carry the ragged
columns, duplicate submissions and malformed phone numbers that handwritten
fixtures never contain. But a real sheet is real applicants' data.

```bash
npm run staging:sandbox-sheet "<production sheet url>" --out sandbox.csv
```

This reads the sheet (read-only — the CSV export endpoint cannot write) and
emits the same columns and the same row count with names, emails and phone
numbers replaced. The replacement is **deterministic**: one input always maps to
the same pseudonym, so a person who submitted twice still appears twice and
deduplication is still exercised. Upload the result to the sandbox spreadsheet
with *File → Import → Replace current sheet*.

`--raw` skips the scrub. It copies real personal data into a sandbox interns can
read, so it needs a reason.

## Known sharp edges

- **Razorpay emails the customer itself.** `notify: { email: true }` in
  `src/lib/payments/razorpay.ts` means Razorpay sends its own mail, which
  `EMAIL_REDIRECT_TO` cannot intercept. Test-mode keys are the only thing
  preventing a real payment email — the key scope on staging is load-bearing.
- **Real form submissions reach staging.** `docs/apps-script/gform-webhook.gs`
  posts every live submission to production *and* staging, by design. With live
  email, staging will send that person a duplicate registration email — again,
  contained only by `EMAIL_REDIRECT_TO`.
- **Groq has no off switch.** "AI suggest" on the admin import screens calls the
  real API and spends real quota.
