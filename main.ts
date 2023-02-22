import { serve } from "./server.ts";
import { db } from "./repo.ts";
import { updateWordList } from "./spam_filter.ts";

(async () => {
  await db.init();
  updateWordList();

  setInterval(() => updateWordList(), 60000 * 5);

  serve(parseInt(Deno.env.get("PORT") || "9000"));
})();
