import { http } from "./deps.ts";
import { nip05Handler, rootHandler } from "./handler.ts";

const Router = new Map<string, Deno.ServeHandler>([
  ["GET/", rootHandler],
  ["GET/.well-known/nostr.json", nip05Handler],
]);

export function serve(port: number) {
  http.serve(async (req) => {
    console.log(req.method, req.url);

    const url = new URL(req.url);
    const fn = Router.get(req.method + url.pathname);
    if (!fn) return new Response(null, { status: 404 });

    try {
      return await fn(req);
    } catch (err) {
      return new Response(err.message, { status: 400 });
    }
  }, { port });
}
