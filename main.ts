import { serve } from "./server.ts";
import { db } from "./repo.ts";

(async () => {
  await db.init();

  serve(parseInt(Deno.env.get("PORT") || "9000"));
})();
