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
      req.headers.get("accept") === "application/nostr+json"
    ) {
      const url = new URL(req.url);
      const paymentUrl = new URL("/", url.origin);
      const info: Record<string, unknown> = {
        ...app.nip11,
        limitation: app.limits,
        payments_url: paymentUrl.href,
        fees: app.fees,
      };

      if (app.retentions.length) {
        info.retention = app.retentions;
      }

      if (app.env.RELAY_COUNTRIES) {
        const arr = app.env.RELAY_COUNTRIES.split(",").filter((i) => i);
        if (arr.length) info.relay_countries = arr;
      }

      if (app.env.LANGUAGE_TAGS) {
        const arr = app.env.LANGUAGE_TAGS.split(",").filter((i) => i);
        if (arr.length) info.language_tags = arr;
      }

      if (app.env.TAGS) {
        const arr = app.env.TAGS.split(",").filter((i) => i);
        if (arr.length) info.tags = arr;
      }

      if (app.env.POSTING_POLICY) {
        info.posting_policy = app.env.POSTING_POLICY;
      }

      return new Response(
        JSON.stringify(info),
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
