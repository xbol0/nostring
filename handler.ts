import { app } from "./app.ts";

const UpgradeResponse = new Response(
  "Please use nostr client for request.",
  { status: 400, headers: { "content-type": "text/plain" } },
);

const CORSHeaders = { "Access-Control-Allow-Origin": "*" };

export async function rootHandler(req: Request) {
  if (req.headers.get("accept") === "application/nostr+json") {
    const host = new URL(req.url).hostname;
    return new Response(
      JSON.stringify({
        "name": Deno.env.get("RELAY_NAME") || host,
        "description": Deno.env.get("RELAY_DESC") || "",
        "pubkey": Deno.env.get("ADMIN_PUBKEY") || "",
        "contact": Deno.env.get("ADMIN_CONTACT") || "",
        "supported_nips": [1, 2, 4, 9, 11, 12, 15, 16, 20, 22, 26, 28, 33, 40],
        "software": "https://github.com/xbol0/nostring",
        "version": "v1",
        ...await app.db.getStatistics(),
      }),
      { headers: { "content-type": "application/nostr+json" } },
    );
  }

  if (!req.headers.has("upgrade")) return UpgradeResponse;

  const res = Deno.upgradeWebSocket(req);
  app.addSocket(res.socket);

  return res.response;
}

export async function nip05Handler(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  if (!name) return new Response(null, { status: 404, headers: CORSHeaders });

  if (name === "_") {
    const pubkey = Deno.env.get("ADMIN_PUBKEY");
    if (!pubkey) {
      return new Response(null, { status: 404, headers: CORSHeaders });
    }
    return new Response(
      JSON.stringify({
        names: { _: pubkey },
        relays: { [pubkey]: [url.origin.replace(/^http/, "ws")] },
      }),
      { headers: { "content-type": "application/json", ...CORSHeaders } },
    );
  }

  try {
    const pubkey = await app.db.getNip05(name);
    return new Response(
      JSON.stringify({
        names: { [name]: pubkey },
        relays: { [pubkey]: [url.origin.replace(/^http/, "ws")] },
      }),
      { headers: { "content-type": "application/json", ...CORSHeaders } },
    );
  } catch (err) {
    return new Response(err.message, {
      status: 400,
      headers: { "content-type": "text/plain", ...CORSHeaders },
    });
  }
}
