import "dotenv/config";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import dotenv from "dotenv";
import { createPasswordHash } from "../src/admin-auth.js";

const envUrl = new URL("../.env", import.meta.url);
const existing = await readFile(envUrl, "utf8");
const config = dotenv.parse(existing);
if (!config.ADMIN_EMAIL) {
  const fallbackUrl = new URL("../.env copy.example", import.meta.url);
  const fallback = dotenv.parse(await readFile(fallbackUrl, "utf8"));
  config.ADMIN_EMAIL = fallback.ADMIN_EMAIL || "admin@bilatec.local";
}

if (!config.DATABASE_URL || !config.ADMIN_EMAIL) {
  throw new Error("backend/.env must contain DATABASE_URL and ADMIN_EMAIL before resetting admin access.");
}
if (/(example|your_|admin@domain)/i.test(config.ADMIN_EMAIL)) {
  throw new Error("Replace the example ADMIN_EMAIL with your administrator email first.");
}

const password = randomBytes(18).toString("base64url");
config.ADMIN_PASSWORD_HASH = createPasswordHash(password);
config.SESSION_SECRET = randomBytes(48).toString("base64url");

const updated = `${Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n")}\n`;
await writeFile(envUrl, updated, { encoding: "utf8", mode: 0o600 });

console.log(`Admin email: ${config.ADMIN_EMAIL}`);
console.log(`New admin password: ${password}`);
console.log("A fresh session secret was generated. The password and hash are not saved in plaintext.");