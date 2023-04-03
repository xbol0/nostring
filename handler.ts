import { Application } from "./app.ts";
import { CORSHeaders, HomeTemplate } from "./constant.ts";
import { nostr } from "./deps.ts";

export function getHandler(app: Application) {
  return (req: Request) => {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORSHeaders });
    }

    if (
      !app.features.disable_nip11 &&
      req.headers.get("accept") === "application/nostr+json" &&
      url.pathname === "/"
    ) {
      return new Response(
        JSON.stringify(app.nip11),
        {
          headers: {
            "content-type": "application/nostr+json",
            ...CORSHeaders,
          },
        },
      );
    }

    if (req.headers.has("upgrade")) {
      const { socket, response } = Deno.upgradeWebSocket(req);
      app.addSocket(socket);

      return response;
    }

    if (req.method === "GET" && url.pathname === "/") {
      return new Response(
        HomeTemplate.replaceAll("%name", app.nip11.name)
          .replaceAll("%desc", app.nip11.description || "~")
          .replaceAll(
            "%admin",
            app.nip11.pubkey ? nostr.nip19.npubEncode(app.nip11.pubkey) : "~",
          )
          .replaceAll(
            "%bot",
            app.botPubkey ? nostr.nip19.npubEncode(app.botPubkey) : "~",
          )
          .replaceAll(
            "%url",
            `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`,
          ),
        { headers: { "content-type": "text/plain" } },
      );
    }

    return new Response(null, { status: 404 });
  };
}
