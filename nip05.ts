import { app } from "./app.ts";
import { hex } from "./deps.ts";
import { NostrEvent } from "./types.ts";

export async function handle23305(ev: NostrEvent, _s: WebSocket) {
  if (ev.content[0] !== "+" && ev.content[0] !== "-") {
    throw new Error("content should starts with + or -");
  }

  const name = ev.content.slice(1);

  if (!/^[a-z0-9_]{4,}$/i.test(name)) {
    throw new Error("Invalid name format, only allow alphanumeric characters");
  }

  ev.content[0] === "+"
    ? await app.db.setNip05(hex.decode(ev.pubkey), name)
    : await app.db.delNip05(hex.decode(ev.pubkey), name);
}
