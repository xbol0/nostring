import { Application } from "../mod.ts";
import { serve } from "https://deno.land/std@0.176.0/http/server.ts";

const app = new Application();
await app.init();
const port = parseInt(Deno.env.get("PORT") || "9000");
serve(app.getHandler(), { port });
