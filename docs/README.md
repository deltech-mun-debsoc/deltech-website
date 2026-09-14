# MUN Platform — Docs

This folder is the canonical source of project documentation. **Read this folder before starting any session.**

## Contents

| File | Purpose |
|------|---------|
| `README.md` | This file — orientation and doc index |
| `DESIGN_TOKENS.md` | How design tokens are used |
| `SPEC.md` | Full product specification |
| `POA.md` | Plan of action / sprint roadmap |
| `MAINTAINER_GUIDE.md` | Staff roles, launch order, workflows, and recovery runbook |

## Quick orientation

- All UI text lives in `src/content/strings.ts` — never hardcode literals in components.
- Global design tokens and shared visual utilities live in `src/app/globals.css`; reusable component variants live beside their components.
- Auth is NextAuth v5 (beta) with the Prisma adapter and Resend email provider.
- Payments use Razorpay (card/netbanking/UPI) with a webhook handler at `/api/webhooks/razorpay`.
- Storage is S3 (files) + Postgres via Prisma (relational data), self-hosted on Lightsail (see docs/AWS.md).
