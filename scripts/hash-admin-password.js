import { randomBytes, scryptSync } from "node:crypto";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("Run this script in an interactive terminal to enter the admin password privately.");
  process.exit(1);
}

process.stdout.write("Admin password: ");
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
let password = "";

for await (const chunk of process.stdin) {
  for (const character of chunk) {
    if (character === "\u0003") process.exit(130);
    if (character === "\r" || character === "\n") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      const salt = randomBytes(16);
      const hash = scryptSync(password, salt, 64);
      console.log(`\nADMIN_PASSWORD_HASH=scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`);
      process.exit(0);
    }
    if (character === "\u007f" || character === "\b") password = password.slice(0, -1);
    else password += character;
  }
}