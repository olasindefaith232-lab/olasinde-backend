import { neon } from "@neondatabase/serverless";

let database;

export function getDatabase() {
  if (!process.env.DATABASE_URL) {
    const error = new Error("DATABASE_URL is not configured. Add your Neon connection string to backend/.env.");
    error.status = 503;
    throw error;
  }
  database ??= neon(process.env.DATABASE_URL);
  return database;
}