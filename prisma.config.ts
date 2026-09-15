import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  // CLI and migrations use DIRECT_URL. Staging and production Postgres listen
  // on each box's loopback only, so CI reaches them through an SSH tunnel
  // (see staging-migrate.yml).
  //
  // Read through process.env rather than prisma/config's env(), which throws
  // when the variable is absent. `prisma generate` never opens a connection,
  // but it does load this file, so env() made `npm install` fail outright in
  // any environment without a database URL: CI jobs that only build, and a
  // fresh clone before .env exists. Commands that actually need the URL
  // (migrate, db seed) fail clearly on their own if it is empty.
  datasource: { url: process.env.DIRECT_URL ?? "" },
});
