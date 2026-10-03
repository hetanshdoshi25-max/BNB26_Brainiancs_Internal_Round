import "../src/env";
import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const count = Number(process.argv[2] ?? 100);
const domain = process.env.LOAD_TEST_EMAIL_DOMAIN ?? "load.fairdrop.test";
const password = process.env.LOAD_TEST_PASSWORD ?? randomBytes(24).toString("base64url");
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

if (!Number.isInteger(count) || count < 1 || count > 50_000) {
  throw new Error("Pass a number of test accounts from 1 to 50000.");
}

async function main() {
  const passwordDigest = createHash("sha256").update(password, "utf8").digest("hex");
  const passwordHash = await bcrypt.hash(passwordDigest, 10);
  const accounts: Array<{ email: string; password: string; sessionToken: string }> = [];
  for (let start = 1; start <= count; start += 1000) {
    const end = Math.min(count, start + 999);
    const batch: typeof accounts = [];
    for (let number = start; number <= end; number++) {
      batch.push({ email: `attendee-${String(number).padStart(5, "0")}@${domain}`, password, sessionToken: randomBytes(32).toString("base64url") });
    }
    await prisma.user.createMany({
      data: batch.map((account) => ({
        email: account.email, passwordHash, name: `Test Attendee ${account.email.split("@")[0].slice(-5)}`,
      })), skipDuplicates: true,
    });
    const users = await prisma.user.findMany({ where: { email: { in: batch.map((account) => account.email) } }, select: { id: true, email: true } });
    const userByEmail = new Map(users.map((user) => [user.email, user.id]));
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60_000);
    await prisma.session.createMany({
      data: batch.flatMap((account) => {
        const userId = userByEmail.get(account.email);
        return userId ? [{ userId, tokenHash: hashToken(account.sessionToken), expiresAt }] : [];
      }), skipDuplicates: true,
    });
    accounts.push(...batch);
    console.log(`Prepared ${end.toLocaleString()} / ${count.toLocaleString()} accounts`);
  }
  const outputPath = path.resolve(__dirname, "../../../tests/load/accounts.local.json");
  await writeFile(outputPath, `${JSON.stringify(accounts, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`Wrote local test credentials to ${outputPath}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
