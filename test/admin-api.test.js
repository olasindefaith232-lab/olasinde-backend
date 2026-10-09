import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { createAdminCookie, createPasswordHash, readAdminSession } from "../src/admin-auth.js";
import { createApp } from "../src/app.js";

let server;
let baseUrl;

before(async () => {
  process.env.ADMIN_EMAIL = "owner@example.com";
  process.env.ADMIN_PASSWORD_HASH = createPasswordHash("test-admin-password");
  process.env.SESSION_SECRET = "local-test-session-secret";
  process.env.CLIENT_ORIGIN = "http://localhost:5173";
  process.env.ADMIN_ORIGIN = "http://localhost:5174";
  server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("rejects admin overview without a signed-in session", async () => {
  const response = await fetch(`${baseUrl}/api/admin/overview`);
  assert.equal(response.status, 401);
});

test("logs in and returns a signed httpOnly session cookie", async () => {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5174" },
    body: JSON.stringify({ email: "owner@example.com", password: "test-admin-password" }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.deepEqual(readAdminSession(cookie) && { email: readAdminSession(cookie).email }, { email: "owner@example.com" });
});

test("rejects an incorrect admin password", async () => {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@example.com", password: "wrong-password" }),
  });
  assert.equal(response.status, 401);
});

test("validates public enquiry fields before requiring Neon", async () => {
  const response = await fetch(`${baseUrl}/api/enquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /required/i);
});

test("rejects client origins not listed in environment", async () => {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://malicious.invalid" },
    body: JSON.stringify({ email: "owner@example.com", password: "test-admin-password" }),
  });
  assert.equal(response.status, 403);
});

test("admin cookie validation rejects tampering", () => {
  const cookie = createAdminCookie("owner@example.com").split(";")[0];
  const [name, token] = cookie.split("=");
  const tampered = `${name}=${token.slice(0, -1)}x`;
  assert.equal(readAdminSession(tampered), null);
});
