import { Application } from "../mod.ts";
import { PgRepository } from "./repo.ts";
import { serve } from "https://deno.land/std@0.176.0/http/server.ts";

const db = new PgRepository(
  Deno.env.get("DB_URL") || "postgres://localhost:5432/nostring",
);
await db.init();
const app = new Application({
  upgradeWebSocketFn: Deno.upgradeWebSocket,
  db,
});
const port = parseInt(Deno.env.get("PORT") || "9000");
serve(app.getHandler(), { port });
