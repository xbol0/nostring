import * as Conn from "./connection.ts";
import { db } from "./repo.ts";

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
        ...await db.getStatistics(),
      }),
      { headers: { "content-type": "application/nostr+json" } },
    );
  }

  if (!req.headers.has("upgrade")) {
    // handle for normal GET request
    return new Response(
      "Please use nostr client for request.",
      { status: 400 },
    );
  }

  const res = Deno.upgradeWebSocket(req);
  Conn.append(res.socket);

  return res.response;
}
