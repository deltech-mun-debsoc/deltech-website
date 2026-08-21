# CI and deployments

## The small-team flow

```text
Pull request → CI → merge to main → automatic Test deploy
                                      ↓
                              inspect Test manually
                                      ↓
                          click Deploy Production
```

There are no pull-request deployments.

| Environment | Vercel scope | Database | URL |
| --- | --- | --- | --- |
| Test | Preview | Neon Test database | `test.deltechmun.in` |
| Production | Production | Supabase Production database | `deltechmun.in` |

Both environments use one Vercel project with separate Preview and Production
variables. `scripts/check-env-isolation.ts` verifies the Vercel scopes.
`scripts/verify-database-isolation.ts` independently verifies the GitHub
database secrets before any Test migration or destructive reset.

## Workflows

| Name | Trigger | Purpose |
| --- | --- | --- |
| **CI** | Pull request or manual | Run the checks and a production build. |
| **Deploy Test** | Push to `main` or manual | Check, migrate Neon, deploy Test, and smoke-test it. |
| **Deploy Production** | Manual | Require current `main` to be live on Test, then build, migrate, deploy, and smoke-test Production. |
| **Reset Test Data** | Manual with confirmation | Recreate Neon and seed complete fake product data. |
| **Set up Test Environment** | Manual | Repair the Vercel Preview variables and stable Test domain. |
| **Run Test Crons** | Daily or manual | Run the protected cron routes against Neon-backed Test. |

Deployments are queued rather than cancelled while a migration may be running.
Vercel uploads use `--archive=tgz`.

### Vercel scope

`.vercel/` is gitignored, so a runner has no project link of its own. Three
secrets pin every Vercel command to one project:

| Secret | Where to get it |
| --- | --- |
| `VERCEL_TOKEN` | Issued from the account or team that owns the project **and** the domains. |
| `VERCEL_ORG_ID` | `vercel link`, then read `orgId` from `.vercel/project.json`. |
| `VERCEL_PROJECT_ID` | The same file's `projectId`. |

Omit the last two and `vercel pull --yes` links to whatever scope the token
defaults to. Everything downstream follows it there, so the deploy succeeds
into the wrong account and only `vercel alias set` fails, with a message about
domain access that does not mention the scope. If that step fails, check which
account the deployment URL names before touching DNS.

A domain can only be aliased to a deployment in the same scope. `dig +short
<host> CNAME` returns a per-account `*.vercel-dns-*.com` target: two hosts with
different hashes are in different accounts and no single token can alias both.

## Database isolation

Test application data lives only in Neon. Production application data lives
only in Supabase. A Test deployment or reset fails before touching a database
unless all of these are true:

- both Test URLs point at Neon;
- the Test runtime URL is pooled;
- the Test migration URL is unpooled;
- both Test URLs identify the same Neon database;
- neither Test URL identifies either Production database endpoint.

The Test and Production `AUTH_SECRET` values are also different, so sessions
cannot cross environments.

Integration credentials are deliberately shared as requested: Resend,
Razorpay, Google Forms, public-sheet sync, cron, Supabase Realtime/Storage, and
Groq. Test emails are redirected to `ADMIN_EMAIL` rather than delivered to
fixture recipients.

## Test data

**Reset Test Data** requires the exact confirmation `reset test data`. It
replays migrations and seeds every meaningful product area:

- the requested admin, maintainer, and registerer accounts;
- Event Control and public-site settings;
- committees, fees, available/held/blocked/allotted portfolios;
- delegates covering every application source and status;
- double delegations, allotments, every payment status, check-in, and email history;
- import presets and quarantined rows;
- recruitment applicants covering every pipeline state and interview slots;
- active and archived team members;
- reversible and view-only audit entries;
- posts covering every editorial state;
- a live quiz, slides, responses, and leaderboard data;
- a harmless expired rate-limit fixture.

Authentication accounts, sessions, and verification tokens are not fabricated.
They are runtime security records, not product test data. Sign in to Test as
`arnavsinghal06@gmail.com`; the real authentication flow creates those records.

Production rows are never copied into Test. Only Google Form, public-sheet, and
import mapping configuration is synchronized.

## Daily use

1. Merge a PR.
2. Wait for **Deploy Test** to turn green.
3. Test at <https://test.deltechmun.in>.
4. Run **Deploy Production** from GitHub Actions.

If fixtures become messy, run **Reset Test Data**. Production deployment is
deliberately a separate button, so inspecting Test remains useful without
adding approval environments or release bureaucracy.

## Connection details

- `STAGING_DIRECT_URL`: Neon unpooled endpoint used for migrations.
- `STAGING_DATABASE_URL`: Neon pooled endpoint used by the Test website.
- `PROD_DIRECT_URL`: Supabase session pooler on port 5432 used for migrations.
- `PROD_DATABASE_URL`: Production runtime connection.

`NEXT_PUBLIC_APP_URL` must be `https://test.deltechmun.in` for Preview and
`https://deltechmun.in` for Production.

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
