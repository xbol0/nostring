import { PgRepository } from "./pg_repo.ts";
import { DataAdapter } from "./types.ts";

function getRepo(url: string): DataAdapter {
  if (!url) throw new Error("Invalid DB_URL");

  if (url.startsWith("postgresql://")) {
    return new PgRepository(url);
  }
  if (url.startsWith("postgres://")) {
    return new PgRepository(url);
  }

  throw new Error("Unsupported data provider");
}

export const db = getRepo(Deno.env.get("DB_URL") || "");
