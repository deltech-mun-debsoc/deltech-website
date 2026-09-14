import "dotenv/config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const configuredPoolMax = Number(process.env.DATABASE_POOL_MAX ?? "15");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Quiz answers arrive as a short auditorium-sized burst. pg's default of 10
  // made 150 independent inserts wait through 15 connection waves even though
  // Postgres (max_connections=50) has room for them. Connections are
  // opened lazily and retired quickly, so ordinary low traffic stays small.
  max: Number.isInteger(configuredPoolMax) && configuredPoolMax > 0 ? configuredPoolMax : 15,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});
const adapter = new PrismaPg(pool);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
