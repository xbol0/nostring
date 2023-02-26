import { nextTick } from "./deps.ts";
import { checkMsg, isEvent, match, validateEvent } from "./nostr.ts";
import { PgRepository } from "./pg_repo.ts";
import type {
  ApplicationInit,
  ClientAuthMessage,
  ClientCloseMessage,
  ClientEventMessage,
  ClientMessage,
  ClientReqMessage,
  DataAdapter,
  NostrEvent,
  ReqParams,
} from "./types.ts";

const CORSHeaders = { "Access-Control-Allow-Origin": "*" };
const NIPs = [1, 2, 4, 9, 11, 12, 15, 16, 20, 22, 26, 28, 33, 40];

export class Application {
  subs = new Map<WebSocket, Record<string, ReqParams[]>>();
  challenges = new Map<WebSocket, string>();
  channel: BroadcastChannel | null = null;
  db: DataAdapter;

  onConnectFn: (ws: WebSocket, req: Request) => unknown = () => void 0;
  onEventFn: (e: NostrEvent) => unknown = () => void 0;
  onAuthFn: (e: NostrEvent) => unknown = () => void 0;

  constructor(opts?: ApplicationInit) {
    this.db = this.getRepo();
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("nostr_event");
    }

    if (opts) {
      if (opts.onConnect) this.onConnectFn = opts.onConnect;
      if (opts.onEvent) this.onEventFn = opts.onEvent;
      if (opts.onAuth) this.onAuthFn = opts.onAuth;
    }
  }

  async init() {
    await this.db.init();
  }

  getRepo() {
    const url = Deno.env.get("DB_URL") || "postgres://localhost:5432/nostring";
    if (!url) throw new Error("Invalid DB_URL");

    if (url.startsWith("postgresql://")) {
      return new PgRepository(url);
    }
    if (url.startsWith("postgres://")) {
      return new PgRepository(url);
    }

    throw new Error("Unsupported data provider");
  }

  addSocket(socket: WebSocket) {
    socket.addEventListener("error", () => {
      this.subs.delete(socket);
      this.challenges.delete(socket);
    });

    socket.addEventListener("close", () => {
      this.subs.delete(socket);
      this.challenges.delete(socket);
    });

    socket.addEventListener("message", (ev) => {
      console.log(ev.data);

      let data: ClientMessage;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return socket.close();
      }

      if (!checkMsg(data)) {
        return send(socket, ["NOTIFY", `Your data is invalid: '${ev.data}'`]);
      }

      switch (data[0]) {
        case "REQ":
          return this.onREQ(data, socket);
        case "CLOSE":
          return this.onCLOSE(data, socket);
        case "AUTH":
          return this.onAUTH(data, socket);
        case "EVENT":
          return this.onEVENT(data, socket);
        default:
          return send(socket, ["NOTIFY", `Unsupported type: '${data[0]}'`]);
      }
    });
  }

  async onREQ(msg: ClientReqMessage, socket: WebSocket) {
    if (typeof msg[1] !== "string") return;
    const filters = msg.slice(2)
      .filter((i) => typeof i === "object") as ReqParams[];
    if (filters.length === 0) return;

    let sub = this.subs.get(socket);
    if (!sub) {
      sub = {};
      this.subs.set(socket, sub);
    }
    sub[msg[1]] = filters;

    const list = await this.db.query(filters);
    list.forEach((i) => send(socket, ["EVENT", msg[1], i]));
    send(socket, ["EOSE", msg[1]]);
  }

  async onEVENT(msg: ClientEventMessage, socket: WebSocket) {
    const ev = msg[1];
    if (!isEvent(ev)) return;

    try {
      await validateEvent(msg[1]);
    } catch (err) {
      return send(socket, ["OK", ev.id, false, "invalid: " + err.message]);
    }

    try {
      await this.onEventFn(ev);
    } catch (err) {
      return send(socket, ["OK", ev.id, false, "invalid: " + err.message]);
    }

    // NIP-16
    if (ev.kind < 10000) {
      // NIP-01
      if (ev.kind === 0) {
        await this.db.replaceEvent(ev);
      } else {
        await this.db.insertEvent(ev);
      }

      // NIP-09 event deletion
      if (ev.kind === 5) {
        const list = ev.tags.filter((i) => i[0] === "e").map((i) => i[1]);
        await this.db.delete(list, ev.pubkey);
      }
    } else if (ev.kind >= 10000 && ev.kind < 20000) {
      await this.db.replaceEvent(ev);
    } else if (ev.kind >= 30000 && ev.kind < 40000) {
      // NIP-33
      await this.db.replaceEvent(ev);
    }

    send(socket, ["OK", ev.id, true, ""]);
    nextTick(() => this.broadcast(ev));
  }

  onCLOSE(msg: ClientCloseMessage, socket: WebSocket) {
    delete this.subs.get(socket)?.[msg[1]];
  }

  async onAUTH(msg: ClientAuthMessage, socket: WebSocket) {
    if (typeof msg !== "object") return;

    if (msg[1].kind !== 22242) return;
    const stored = msg[1].tags.find((i) => i[0] === "challenge");
    if (!stored) return;
    const challenge = this.challenges.get(socket);
    if (stored[1] !== challenge) return;

    try {
      await validateEvent(msg[1]);
      await this.onAuthFn(msg[1]);

      send(socket, ["OK", msg[1].id, true, ""]);
    } catch (err) {
      send(socket, ["OK", msg[1].id, false, "restricted: " + err.message]);
    } finally {
      this.challenges.delete(socket);
    }
  }

  getHandler() {
    return async (req: Request) => {
      if (req.headers.get("accept") === "application/nostr+json") {
        const host = new URL(req.url).hostname;
        return new Response(
          JSON.stringify({
            "name": Deno.env.get("RELAY_NAME") || host,
            "description": Deno.env.get("RELAY_DESC") || "",
            "pubkey": Deno.env.get("ADMIN_PUBKEY") || "",
            "contact": Deno.env.get("ADMIN_CONTACT") || "",
            "supported_nips": NIPs,
            "software": "https://github.com/xbol0/nostring",
            "version": "v1",
            ...await this.db.getStatistics(),
          }),
          {
            headers: {
              "content-type": "application/nostr+json",
              ...CORSHeaders,
            },
          },
        );
      }

      if (!req.headers.has("upgrade")) {
        return new Response(
          "Please use nostr client for request.",
          {
            status: 400,
            headers: { "content-type": "text/plain", ...CORSHeaders },
          },
        );
      }

      const res = Deno.upgradeWebSocket(req);
      try {
        await this.onConnectFn(res.socket, req);
        this.addSocket(res.socket);
      } catch (err) {
        return new Response(err.message, {
          status: 400,
          headers: { "content-type": "text/plain", ...CORSHeaders },
        });
      }

      return res.response;
    };
  }

  async broadcast(ev: NostrEvent) {
    if (!this.channel) return;
    for (const [ws, info] of this.subs.entries()) {
      for (const [id, filters] of Object.entries(info)) {
        for (const item of filters) {
          if (!match(ev, item)) continue;
          try {
            await this.onEventFn(ev);
          } catch {
            continue;
          }

          send(ws, ["EVENT", id, ev]);
          break;
        }
      }
    }
  }
}

function send(socket: WebSocket, data: unknown[]) {
  try {
    socket.send(JSON.stringify(data));
  } catch {
    // Skip error handle
  }
}
