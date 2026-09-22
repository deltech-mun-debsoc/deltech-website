// Set (or reset) a user's password, optionally promoting them to a role.
//   npx tsx scripts/set-password.ts <email> <password> [role]
// Role is one of ADMIN | MAINTAINER | AUTHOR | REGISTERER. Creates the user if
// they don't exist; leaves the role untouched on existing users unless given.
import "dotenv/config";
import { PrismaClient, Role } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { hashPassword } from "../src/lib/password";
import { validatePassword, PASSWORD_MIN, PASSWORD_MAX } from "../src/lib/schemas/password";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const [emailArg, password, roleArg] = process.argv.slice(2);
  const email = emailArg?.trim().toLowerCase();

  if (!email || !password) {
    throw new Error("Usage: npx tsx scripts/set-password.ts <email> <password> [role]");
  }
  // Same rule as the web flows, imported rather than restated so the two
  // cannot drift apart.
  if (validatePassword(password)) {
    throw new Error(`Password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`);
  }
  if (roleArg && !(roleArg in Role)) {
    throw new Error(`Invalid role "${roleArg}". Expected one of: ${Object.keys(Role).join(", ")}`);
  }
  const role = roleArg as Role | undefined;

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    // This is an operator-only recovery/provisioning command. Marking the
    // mailbox verified is explicit here so the credential provider does not
    // create an unusable password account.
    update: { passwordHash, emailVerified: new Date(), ...(role ? { role } : {}) },
    create: { email, passwordHash, emailVerified: new Date(), role: role ?? Role.AUTHOR },
    select: { id: true, email: true, role: true },
  });

  console.log(`Password set for ${user.email} (role: ${user.role}, id: ${user.id})`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
