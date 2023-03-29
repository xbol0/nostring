import { Application } from "./app.ts";
import { render } from "./web.ts";

const CORSHeaders = { "Access-Control-Allow-Origin": "*" };

export function getHandler(app: Application) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORSHeaders });
    }

    if (req.headers.get("accept") === "application/nostr+json") {
      const url = new URL(req.url);
      const paymentUrl = new URL("/payments", url.origin);
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

    try {
      return await render(req, app);
    } catch (err) {
      return new Response(err.message, { status: 400 });
    }
  };
}
