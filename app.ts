import { nextTick } from "./deps.ts";
import { handle23305 } from "./nip05.ts";
import {
  getDelegator,
  isEvent,
  matchSubscription,
  send,
  validateEvent,
  verifyData,
} from "./nostr.ts";
import { PgRepository } from "./pg_repo.ts";
import { SpamFilter } from "./spam_filter.ts";
import type {
  ClientAuthMessage,
  ClientCloseMessage,
  ClientEventMessage,
  ClientMessage,
  ClientReqMessage,
  DataAdapter,
  NostrEvent,
  ReqParams,
} from "./types.ts";

const ErrNip22 =
  "invalid: the event created_at field is out of the acceptable range (-30min, +15min) for this relay";
const DB_DEFAULT = "postgres://localhost:5432/nostring";

export class Application {
  subs = new Map<WebSocket, Record<string, ReqParams[]>>();
  challenges = new Map<WebSocket, string>();
  channel: BroadcastChannel | null = null;
  db: DataAdapter;
  filter = new SpamFilter();

  constructor() {
    this.db = this.getRepo();
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("nostr_event");
    }
  }

  async init() {
    console.log("Starting application...");
    await this.db.init();

    this.filter.updateWordList();
    setInterval(() => this.filter.updateWordList(), 300000);
  }

  getRepo() {
    const url = Deno.env.get("DB_URL") || DB_DEFAULT;
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
    socket.addEventListener("error", (ev) => {
      console.error(ev);
      try {
        socket.close();
      } finally {
        this.subs.delete(socket);
        this.challenges.delete(socket);
      }
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
        socket.close();
        return;
      }

      if (!verifyData(data)) {
        console.log("Invalid data", data);
        return;
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
          return;
      }
    });
  }

  onREQ(msg: ClientReqMessage, socket: WebSocket) {
    if (typeof msg[1] !== "string") return;
    const filters = msg.slice(2).filter((i) =>
      typeof i === "object"
    ) as ReqParams[];
    if (filters.length === 0) return;

    let sub = this.subs.get(socket);
    if (!sub) {
      sub = {};
      this.subs.set(socket, sub);
    }
    sub[msg[1]] = filters;

    nextTick(async () => {
      const list = await this.db.query(filters);
      console.log("found", list.length, "events");

      list.forEach((i) => send(socket, ["EVENT", msg[1], i]));
      send(socket, ["EOSE", msg[1]]);
    });
  }

  async onEVENT(msg: ClientEventMessage, socket: WebSocket) {
    const ev = msg[1];
    if (!isEvent(ev)) return;

    try {
      await validateEvent(msg[1]);
    } catch (err) {
      return send(socket, ["OK", ev.id, false, "invalid: " + err.message]);
    }

    // NIP-26
    try {
      await getDelegator(ev);
    } catch (err) {
      return send(socket, ["OK", ev.id, false, "invalid: " + err.message]);
    }

    // NIP-22
    const now = ~~(Date.now() / 1000);
    if (ev.created_at > now + 15 * 60 || ev.created_at < now - 30 * 60) {
      return send(socket, ["OK", ev.id, false, ErrNip22]);
    }

    // filter spam
    if (ev.kind === 1 && this.filter.isSpam(ev.content)) {
      return send(socket, ["OK", ev.id, false, "invalid: spam filter"]);
    }

    // NIP-16
    if (ev.kind < 10000) {
      // NIP-40
      const f = ev.tags.find((i) => i[0] === "expiration");
      if (f) ev.expires_at = +f[1];

      // NIP-01
      if (ev.kind === 0) {
        await this.db.replaceEvent(ev);
        console.log(`usermeta ${ev.pubkey} stored`);
      } else {
        await this.db.insertEvent(ev);
        console.log(`${ev.id} stored`);
      }

      // NIP-09 event deletion
      if (ev.kind === 5) {
        console.log(`DELETE REASON: ${ev.content}`);

        const list = ev.tags.filter((i) => i[0] === "e").map((i) => i[1]);
        await this.db.delete(list, ev.pubkey);
      }
    } else if (ev.kind >= 10000 && ev.kind < 20000) {
      await this.db.replaceEvent(ev);
    } else if (ev.kind >= 20000 && ev.kind < 30000) {
      // Ephemeral Events, no store
      console.log(`${ev.id} kind=${ev.kind} no store`);
    } else if (ev.kind >= 30000 && ev.kind < 40000) {
      // NIP-33
      await this.db.replaceEvent(ev);
    }

    try {
      if (ev.kind === 23305) await handle23305(ev, socket);

      send(socket, ["OK", ev.id, true, ""]);
    } catch (err) {
      return send(socket, ["OK", ev.id, false, "invalid: " + err.message]);
    } finally {
      // its should always forward to client and other relay,
      // even this event fail on current application
      nextTick(() => this.broadcast(ev));

      if (this.channel) this.channel.postMessage(ev);
    }
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

      send(socket, ["OK", msg[1].id, true, ""]);
    } catch (err) {
      send(socket, ["OK", msg[1].id, false, "restricted: " + err.message]);
    } finally {
      this.challenges.delete(socket);
    }
  }

  broadcast(ev: NostrEvent) {
    if (!this.channel) return;
    for (const [ws, info] of this.subs.entries()) {
      for (const [id, filters] of Object.entries(info)) {
        for (const item of filters) {
          if (!matchSubscription(ev, item)) continue;
          if (ev.kind === 1 && this.filter.isSpam(ev.content)) continue;

          ws.send(JSON.stringify(["EVENT", id, ev]));

          break;
        }
      }
    }
  }
}

export const app = new Application();
