import { checkMsg, isEvent, match, validateEvent } from "./nostr.ts";
import type {
  ApplicationInit,
  ClientAuthMessage,
  ClientCloseMessage,
  ClientEventMessage,
  ClientMessage,
  ClientReqMessage,
  DataAdapter,
  Nip11,
  NostrEvent,
  ReqParams,
} from "./types.ts";

const CORSHeaders = { "Access-Control-Allow-Origin": "*" };

export class Application {
  subs = new Map<WebSocket, Record<string, ReqParams[]>>();
  challenges = new Map<WebSocket, string>();
  db: DataAdapter;

  onConnectFn: Required<ApplicationInit>["onConnect"];
  onEventFn: Required<ApplicationInit>["onEvent"];
  onAuthFn: Required<ApplicationInit>["onAuth"];
  onReqFn: Required<ApplicationInit>["onReq"];
  onStreamFn: Required<ApplicationInit>["onStream"];
  onEstablishedFn: Required<ApplicationInit>["onEstablished"];

  upgradeWS: (req: Request) => { socket: WebSocket; response: Response };

  minPow = 0;
  nip11: Nip11;

  constructor(opts: ApplicationInit) {
    if (!opts.db) throw new Error("Require db");
    if (!opts.upgradeWebSocketFn) throw new Error("Require upgradeWebSocketFn");
    this.db = opts.db;
    this.upgradeWS = opts.upgradeWebSocketFn;
    this.onConnectFn = opts.onConnect || (() => void 0);
    this.onEventFn = opts.onEvent || (() => void 0);
    this.onAuthFn = opts.onAuth || (() => void 0);
    this.onReqFn = opts.onReq || (() => void 0);
    this.onEstablishedFn = opts.onEstablished || (() => void 0);
    this.onStreamFn = opts.onStream || (() => true);
    this.minPow = opts.minPow || 0;
    this.nip11 = {
      name: opts.name || "nostring",
      contact: opts.contact || "",
      description: opts.description || "",
      pubkey: opts.pubkey || "",
      software: "https://github.com/xbol0/nostring",
      supported_nips: [1, 2, 4, 9, 11, 12, 15, 16, 20, 22, 26, 28, 33, 40],
      version: "2.2.0",
      ...opts.nip11,
    };
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
      let data: ClientMessage;
      try {
        data = JSON.parse(ev.data);
      } catch {
        this.send(socket, ["NOTIFY", "Invalid body"]);
        return socket.close();
      }

      if (!checkMsg(data)) {
        return this.send(socket, [
          "NOTIFY",
          `Your data is invalid: '${ev.data}'`,
        ]);
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
          return this.send(socket, [
            "NOTIFY",
            `Unsupported type: '${data[0]}'`,
          ]);
      }
    });
  }

  async onREQ(msg: ClientReqMessage, socket: WebSocket) {
    if (typeof msg[1] !== "string") return;
    const filters = msg.slice(2)
      .filter((i) => typeof i === "object") as ReqParams[];
    if (filters.length === 0) return;

    try {
      await this.onReqFn(msg[1], filters, socket);
    } catch (err) {
      this.send(socket, ["NOTIFY", err.message]);
      return;
    }

    let sub = this.subs.get(socket);
    if (!sub) {
      sub = {};
      this.subs.set(socket, sub);
    }
    sub[msg[1]] = filters;

    const list = await this.db.query(filters);
    list.forEach((i) =>
      this.onStreamFn(i, msg[1], socket) &&
      this.send(socket, ["EVENT", msg[1], i])
    );
    this.send(socket, ["EOSE", msg[1]]);
  }

  async onEVENT(msg: ClientEventMessage, socket: WebSocket) {
    const ev = msg[1];
    if (!isEvent(ev)) return;

    try {
      await validateEvent(msg[1], this.minPow);
    } catch (err) {
      return this.send(socket, ["OK", ev.id, false, "invalid: " + err.message]);
    }

    try {
      await this.onEventFn(ev, socket);
    } catch (err) {
      return this.send(socket, ["OK", ev.id, false, "invalid: " + err.message]);
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

    this.send(socket, ["OK", ev.id, true, ""]);
    this.broadcast(ev);
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
      await validateEvent(msg[1], this.minPow);
      await this.onAuthFn(msg[1], socket);

      this.send(socket, ["OK", msg[1].id, true, ""]);
    } catch (err) {
      this.send(socket, ["OK", msg[1].id, false, "restricted: " + err.message]);
    } finally {
      this.challenges.delete(socket);
    }
  }

  getHandler() {
    return async (req: Request) => {
      if (req.headers.get("accept") === "application/nostr+json") {
        return new Response(
          JSON.stringify(this.nip11),
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

      try {
        const res = this.upgradeWS(req);
        await this.onConnectFn(res.socket, req);
        this.addSocket(res.socket);

        res.socket.addEventListener("open", () => {
          this.onEstablishedFn(res.socket);
        }, { once: true });

        return res.response;
      } catch (err) {
        return new Response(err.message, {
          status: 400,
          headers: { "content-type": "text/plain", ...CORSHeaders },
        });
      }
    };
  }

  broadcast(ev: NostrEvent) {
    for (const [ws, info] of this.subs.entries()) {
      for (const [id, filters] of Object.entries(info)) {
        for (const item of filters) {
          if (!match(ev, item)) continue;

          this.send(ws, ["EVENT", id, ev]);
          break;
        }
      }
    }
  }

  send(socket: WebSocket, data: unknown[]) {
    if (socket.readyState !== socket.OPEN) {
      return;
    }

    try {
      socket.send(JSON.stringify(data));
    } catch (e) {
      // Skip error handle
      console.error(e);
    }
  }
}
