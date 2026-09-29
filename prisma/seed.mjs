/**
 * Idempotent bootstrap: creates the first ADMIN from ADMIN_EMAIL / ADMIN_PASSWORD.
 * Safe to run on every deploy — it only creates when no admin exists.
 * Plain ESM JavaScript on purpose: the production image runs it with `node` (no tsx there).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  const admins = await prisma.user.count({ where: { role: "ADMIN" } });
  if (admins > 0) {
    console.log(`[seed] ${admins} admin(s) already present — nothing to do`);
    return;
  }
  if (!email || !password) {
    throw new Error("[seed] No admin exists and ADMIN_EMAIL / ADMIN_PASSWORD are not set");
  }
  if (password.length < 10) {
    throw new Error("[seed] ADMIN_PASSWORD must be at least 10 characters");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({ where: { email } });
  const user = existing
    ? await prisma.user.update({ where: { email }, data: { role: "ADMIN", passwordHash } })
    : await prisma.user.create({ data: { email, passwordHash, name: "Admin", role: "ADMIN" } });

  await prisma.auditLog.create({ data: { userId: user.id, action: "seed.admin_created", target: user.email } });
  console.log(`[seed] admin ready: ${user.email}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
