import { Bot, handleBotMessage } from "./bot.ts";
import { DefaultNIPs, DefaultTimeRange } from "./constant.ts";
import { decoder, hex, http, nostr } from "./deps.ts";
import { getHandler } from "./handler.ts";
import { handlePayment, LnurlPayment } from "./lnurl.ts";
import { PgRepo } from "./pg.ts";
import { EventRetention, Limits, Nip11, Repository } from "./types.ts";
import { FeeType, parseEventRetention, parseFeeConfigure } from "./util.ts";

export class Application {
  subs = new Map<WebSocket, Record<string, nostr.Filter[]>>();
  challenges = new Map<WebSocket, string>();
  authed = new Map<WebSocket, string>();

  repo: Repository;
  payment: LnurlPayment | null = null;
  bot: Bot | null = null;

  port: number;
  nip11: Nip11;
  limits: Limits;
  createdAtRange: number[];
  botKey: string;
  botPubkey: string;
  relays: string[] = [];
  pool: nostr.SimplePool;
  retentions: EventRetention[] = [];
  env: Record<string, string> = {};

  // Whitelist pubkeys
  pubkeys: string[] = [];

  // Payment settings
  fees = {
    admission: [] as FeeType[],
    subscription: [] as FeeType[],
    publication: [] as FeeType[],
  };
  defaultPlan: FeeType | null = null;

  constructor() {
    const env = Deno.env.toObject();
    this.env = env;

    this.repo = new PgRepo(
      env.DB_URL || "postgres://localhost:5432/nostring",
      this,
    );

    if (env.PAYMENT_LNURL) {
      if (!env.BOT_KEY) {
        throw new Error("You should setup a BOT_KEY for handle payment.");
      }

      this.payment = new LnurlPayment(this);
    }

    this.createdAtRange = (env.EVENT_TIEMSTAMP_RANGE || DefaultTimeRange)
      .split("~").map(parseInt);
    if (this.createdAtRange.length !== 2) {
      throw new Error("Invalid createdAt range");
    }

    this.port = parseInt(env.PORT || "9000");
    this.nip11 = {
      name: env.RELAY_NAME || "nostring",
      contact: env.ADMIN_CONTACT || "",
      description: env.RELAY_DESC || "",
      pubkey: env.ADMIN_PUBKEY || "",
      software: "https://github.com/xbol0/nostring",
      supported_nips: (env.NIPS || DefaultNIPs).split(",")
        .map((i) => parseInt(i)),
      version: "3.0.0",
    };
    this.limits = {
      maxMessageLength: parseInt(env.MAX_MESSAGE_LENGTH) || 393216,
      maxSubscriptions: parseInt(env.MAX_SUBSCRIPTIONS) || 32,
      maxFilters: parseInt(env.MAX_FILTERS) || 10,
      maxLimit: parseInt(env.MAX_LIMIT) || 500,
      maxSubidLength: parseInt(env.MAX_SUBID_LENGTH) || 64,
      minPrefix: parseInt(env.MIN_PREFIX) || 32,
      maxEventTags: parseInt(env.MAX_EVENT_TAGS) || 2048,
      maxContentLength: parseInt(env.MAX_CONTENT_LENGTH) || 102400,
      minPowDifficulty: parseInt(env.MIN_POW_DIFFICULTY) || 0,
      authRequired: env.AUTH_REQUIRED === "true",
      paymentRequired: env.PAYMENT_REQUIRED === "true",
    };

    const arr = (env.BROADCAST_RELAYS || "").split(",");
    this.pool = new nostr.SimplePool();

    arr.forEach((i) => {
      if (/^wss?\:\/\//.test(i)) {
        this.relays.push(i);
        this.pool.ensureRelay(i).then((relay) => {
          console.log(`Broadcast relay ready: ${relay.url}`);
        });
      }
    });

    if (env.EVENT_RETENTION) {
      this.retentions = parseEventRetention(env.EVENT_RETENTION);
    }

    if (env.WHITELIST_PUBKEYS) {
      const keys = env.WHITELIST_PUBKEYS.split(",");

      for (const i of keys) {
        if (/^[a-f0-9]{64}$/.test(i)) this.pubkeys.push(i);
      }
    }

    if (env.FEES_ADMISSION) {
      this.fees.admission = parseFeeConfigure(env.FEES_ADMISSION);
    }
    if (env.FEES_SUBSCRIPTION) {
      this.fees.subscription = parseFeeConfigure(env.FEES_SUBSCRIPTION);
    }
    if (env.FEES_PUBLICATION) {
      this.fees.publication = parseFeeConfigure(env.FEES_PUBLICATION);
    }

    if (this.fees.admission.length) {
      this.defaultPlan = this.fees.admission[0];
    } else if (this.fees.subscription.length) {
      this.defaultPlan = this.fees.subscription[0];
    }

    this.botKey = env.BOT_KEY;

    if (this.botKey && !/^[a-f0-9]{64}$/.test(this.botKey)) {
      throw new Error("Invalid bot key");
    } else {
      this.botPubkey = nostr.getPublicKey(this.botKey);
      this.bot = new Bot(this.botKey, this);
    }
  }

  addSocket(socket: WebSocket) {
    socket.addEventListener("open", () => {
      if (this.limits.authRequired) {
        this.sendAuth(socket);
      }
    }, { once: true });

    socket.addEventListener("error", () => {
      this.subs.delete(socket);
      this.challenges.delete(socket);
      this.authed.delete(socket);
    });

    socket.addEventListener("close", () => {
      this.subs.delete(socket);
      this.challenges.delete(socket);
      this.authed.delete(socket);
    });

    socket.addEventListener("message", (ev) => {
      let data: [string, ...unknown[]];

      const str = typeof ev.data === "string"
        ? ev.data
        : decoder.decode(ev.data);

      if (
        this.limits.maxMessageLength &&
        str.length > this.limits.maxMessageLength
      ) {
        return this.send(socket, [
          "NOTIFY",
          "Message body size out of limits: " + this.limits.maxMessageLength,
        ]);
      }

      try {
        data = JSON.parse(str);

        if (!Array.isArray(data)) {
          throw new Error("Not an Array");
        }

        if (data.length < 2) {
          throw new Error("Array length should greater than 2");
        }

        if (typeof data[0] !== "string") {
          throw new Error("Invalid message type");
        }

        if (
          data[0] === "EVENT" &&
          !nostr.validateEvent(data[1] as nostr.UnsignedEvent)
        ) {
          throw new Error("Invalid event message");
        }

        if (
          data[0] === "AUTH" &&
          !nostr.validateEvent(data[1] as nostr.UnsignedEvent)
        ) {
          throw new Error("Invalid auth message");
        }

        if (data[0] === "CLOSE" && typeof data[1] !== "string") {
          throw new Error("Invalid close message");
        }

        if (data[0] === "REQ") {
          if (typeof data[1] !== "string") {
            throw new Error("Invalid req message");
          }

          if (data[1].length > this.limits.maxSubidLength) {
            throw new Error("Subscription ID out of limit");
          }

          if (data.length < 3) {
            throw new Error("Invalid req message");
          }

          if (!data.slice(2).every((i) => typeof i === "object" && i)) {
            throw new Error("Invalid req message");
          }
        }
      } catch (e) {
        return this.send(socket, ["NOTIFY", "Invalid body: " + e.message]);
      }

      switch (data[0]) {
        case "REQ":
          return this.onREQ(
            data[1] as string,
            data.slice(2) as nostr.Filter[],
            socket,
          );
        case "CLOSE":
          return this.onCLOSE(data[1] as string, socket);
        case "AUTH":
          return this.onAUTH(data[1] as nostr.Event, socket);
        case "EVENT":
          return this.onEVENT(data[1] as nostr.Event, socket);
        default:
          return this.send(socket, ["NOTIFY", `Unknown type: '${data[0]}'`]);
      }
    });
  }

  async onREQ(id: string, filters: nostr.Filter[], socket: WebSocket) {
    let sub = this.subs.get(socket);
    if (!sub) {
      sub = {};
      this.subs.set(socket, sub);
    }

    if (
      this.limits.maxSubscriptions &&
      Object.keys(sub).length > this.limits.maxSubscriptions
    ) {
      return this.send(socket, [
        "NOTIFY",
        `${id}: Connection subscriptions out of limit`,
      ]);
    }

    if (this.limits.maxFilters && filters.length > this.limits.maxFilters) {
      return this.send(socket, [
        "NOTIFY",
        `${id}: Subscription filters out of limit`,
      ]);
    }

    for (const i of filters) {
      if (i.kinds?.includes(4)) {
        if (!this.authed.has(socket)) {
          this.send(socket, [
            "NOTIFY",
            `${id}: Kind 4 subscription needs authentication`,
          ]);

          return this.sendAuth(socket);
        }
      }

      if (Object.keys(i).filter((j) => j != "limit").length === 0) {
        return this.send(socket, ["NOTIFY", "DO not pass empty filter"]);
      }
    }

    sub[id] = filters;

    for (const f of filters) {
      try {
        (await this.repo.query(f))
          .forEach((i) => this.send(socket, ["EVENT", id, i]));
      } catch (e) {
        console.error(e);
        this.send(socket, ["NOTIFY", `${id}: ${e.message}`]);

        await this.report(`REQ Error: ${e.message}
Filter: ${JSON.stringify(f, null, 2)}
Time: ${new Date().toISOString()}`);
      }
    }

    this.send(socket, ["EOSE", id]);
  }

  async onEVENT(ev: nostr.Event, socket: WebSocket) {
    if (ev.content.length > this.limits.maxContentLength) {
      return this.send(socket, ["NOTIFY", "Content length out of limit"]);
    }

    if (ev.kind < 0 || ev.kind >= 40000) {
      return this.send(socket, ["OK", ev.id, false, "invalid: Unknown kind"]);
    }

    if (ev.content.length > this.limits.maxContentLength) {
      return this.send(socket, [
        "OK",
        ev.id,
        false,
        "invalid: Content length out of limit",
      ]);
    }

    if (ev.tags.length > this.limits.maxEventTags) {
      return this.send(socket, [
        "OK",
        ev.id,
        false,
        "invalid: Event count out of limit",
      ]);
    }

    // NIP-22
    const now = ~~(Date.now() / 1000);
    if (
      ev.created_at > now + this.createdAtRange[1] ||
      ev.created_at < now + this.createdAtRange[0]
    ) {
      return this.send(socket, [
        "OK",
        ev.id,
        false,
        "invalid: created_at field is out of the acceptable range",
      ]);
    }

    if (!nostr.verifySignature(ev)) {
      return this.send(socket, [
        "OK",
        ev.id,
        false,
        "invalid: Unverified signature",
      ]);
    }

    // NIP-13: PoW
    if (this.limits.minPowDifficulty) {
      const pow = ev.tags.find((i) => i[0] === "nonce");
      if (!pow) {
        return this.send(socket, [
          "NOTIFY",
          "PoW less then " + this.limits.minPowDifficulty,
        ]);
      }
      const diff = parseInt(pow[2]);
      if (diff < this.limits.minPowDifficulty) {
        return this.send(socket, [
          "NOTIFY",
          "PoW less then " + this.limits.minPowDifficulty,
        ]);
      }

      const buf = hex.decode(ev.id.slice(0, Math.ceil(diff / 8) * 2));
      const str = [...buf].map((i) => i.toString(2).padStart(8, "0")).slice(
        diff,
      );
      if (!str.every((i) => i === "0")) {
        return this.send(socket, ["NOTIFY", "Invalid POW"]);
      }
    }

    // NIP-26
    if (ev.tags.find((i) => i[0] === "delegation")) {
      if (!nostr.nip26.getDelegator(ev)) {
        return this.send(socket, ["NOTIFY", "Invalid delegation"]);
      }
    }

    try {
      await this.repo.save(ev);
    } catch (err) {
      this.send(socket, ["OK", ev.id, false, `invalid: ${err.message}`]);
    }

    this.send(socket, ["OK", ev.id, true, ""]);
    this.notify(ev);

    if (
      ev.kind === 4 && this.botKey &&
      ev.tags.find((i) => i[0] === "p")?.[1] === this.botPubkey
    ) {
      handleBotMessage(ev, this);
      return;
    }

    if (
      ev.kind === 9735 && this.payment && ev.pubkey === this.payment.pubkey &&
      ev.tags.find((i) => i[0] === "p")?.[1] === this.botPubkey
    ) {
      handlePayment(this, ev);
    }

    this.broadcast(ev);
  }

  onCLOSE(id: string, socket: WebSocket) {
    delete this.subs.get(socket)?.[id];
  }

  onAUTH(ev: nostr.Event, socket: WebSocket) {
    if (ev.kind !== 22242) return;
    const stored = ev.tags.find((i) => i[0] === "challenge");
    if (!stored) return;
    const challenge = this.challenges.get(socket);
    if (stored[1] !== challenge) return;

    if (!nostr.verifySignature(ev)) {
      return this.send(socket, [
        "OK",
        ev.id,
        false,
        "invalid: Unverified signature",
      ]);
    }

    this.authed.set(socket, ev.pubkey);
    this.challenges.delete(socket);
    this.send(socket, ["OK", ev.id, true, ""]);
  }

  getHandler() {
    return getHandler(this);
  }

  notify(ev: nostr.Event) {
    for (const [ws, info] of this.subs.entries()) {
      for (const [id, filters] of Object.entries(info)) {
        if (nostr.matchFilters(filters, ev)) {
          this.send(ws, ["EVENT", id, ev]);
        }
      }
    }
  }

  send(socket: WebSocket, data: unknown[]) {
    if (socket.readyState !== socket.OPEN) return;

    try {
      socket.send(JSON.stringify(data));
    } catch (e) {
      // Skip error handle
      console.error(e);
    }
  }

  sendAuth(socket: WebSocket) {
    const c = crypto.randomUUID();
    this.challenges.set(socket, c);
    this.send(socket, ["AUTH", c]);
  }

  async report(s: string) {
    if (!this.botKey || !this.nip11.pubkey) return;
    try {
      const ev = nostr.finishEvent({
        kind: 4,
        created_at: ~~(Date.now() / 1000),
        tags: [["p", this.nip11.pubkey]],
        content: await nostr.nip04.encrypt(this.botKey, this.nip11.pubkey, s),
      }, this.botKey);

      await this.repo.save(ev);
      this.notify(ev);
    } catch (e) {
      console.error("REPORT Error:", e);
    }
  }

  broadcast(e: nostr.Event) {
    if (!this.relays.length) return;
    this.pool.publish(this.relays, e);
  }

  async serve() {
    await this.repo.init();
    await this.payment?.init();
    await this.bot?.init();

    http.serve(this.getHandler(), { port: this.port });
  }
}
