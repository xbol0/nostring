import { Application } from "./app.ts";
import { DefaultBotAvatar } from "./constant.ts";
import { nostr } from "./deps.ts";
import { formatSeconds } from "./util.ts";

export async function handleBotMessage(e: nostr.Event, app: Application) {
  const message = await app.bot!.decrypt(e);
  const match = message.match(/^\/[a-z0-9_]+/);
  if (!match) return;

  switch (match[0].slice(1)) {
    case "join":
      return await sendInvoice(e, app);
    case "stat":
      return await app.report("hello");
    default:
      return await app.report("Unknown command: " + match[0]);
  }
}

async function sendInvoice(e: nostr.Event, app: Application) {
  if (!app.payment || !app.bot || !app.defaultPlan) return;
  try {
    const invoice = await app.payment.create(1000);
    await app.repo.createInvoice({
      id: invoice.payment_hash,
      amount: app.defaultPlan.amount,
      bolt11: invoice.bolt11,
      paid_at: null,
      description: e.pubkey + "'s fee of " +
        (app.defaultPlan.period ? "subscription" : "admission"),
      expired_at: invoice.expiry,
      pubkey: e.pubkey,
    });

    let msg = "";
    if (app.defaultPlan.period) {
      msg +=
        `Please find below a payment request for your subscription, it will be expired at ${
          formatSeconds(~~(invoice.expiry.getTime() / 1000))
        }. You are required to pay ${app.defaultPlan.amount} sats every ${
          formatSeconds(app.defaultPlan.period)
        }`;
    } else {
      msg +=
        `Please find below a payment request for your admission, it will be expired at ${
          formatSeconds(~~(invoice.expiry.getTime() / 1000))
        }. You are required to make the payment only once.`;
    }

    msg += "\n" + invoice.bolt11;

    return await app.bot.send(e.pubkey, msg);
  } catch (e) {
    console.error(e);
    return;
  }
}

export class Bot {
  key: string;
  app: Application;
  meta = { picture: "", name: "", username: "" };

  constructor(key: string, app: Application) {
    this.key = key;
    this.app = app;
    this.meta.name = app.env.BOT_NAME || `${app.nip11.name}'s bot`;
    this.meta.username = `${app.nip11.name}_bot`;
    this.meta.picture = app.env.BOT_AVATAR || DefaultBotAvatar;
  }

  async init() {
    const pubkey = nostr.getPublicKey(this.key);
    const list = await this.app.repo.query({
      kinds: [0],
      authors: [pubkey],
      limit: 1,
    });

    if (list.length) {
      const data = JSON.parse(list[0].content) as Record<string, string>;
      if (
        data.name === this.meta.name && data.picture === this.meta.picture &&
        data.username === this.meta.username &&
        data.lud06 === this.app.payment?.lnurl
      ) {
        return;
      }
    }

    const e = nostr.finishEvent({
      created_at: ~~(Date.now()),
      kind: 0,
      tags: [],
      content: JSON.stringify({
        ...this.meta,
        lud06: this.app.payment?.lnurl || "",
      }),
    }, this.key);
    await this.app.repo.save(e);
    this.app.notify(e);
    this.app.broadcast(e);

    console.log("Update bot information success");
  }

  async send(pubkey: string, msg: string, tags?: string[][]) {
    const e = nostr.finishEvent({
      kind: 4,
      tags: [["p", pubkey], ...(tags || [])],
      created_at: ~~(Date.now() / 1000),
      content: await nostr.nip04.encrypt(this.key, pubkey, msg),
    }, this.key);
    await this.app.repo.save(e);
    this.app.notify(e);
  }

  async decrypt(e: nostr.Event) {
    return await nostr.nip04.decrypt(this.key, e.pubkey, e.content);
  }
}
