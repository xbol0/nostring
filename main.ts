import { serve } from "./server.ts";
import { app } from "./app.ts";

(async () => {
  await app.init();

  serve(parseInt(Deno.env.get("PORT") || "9000"));
})();
