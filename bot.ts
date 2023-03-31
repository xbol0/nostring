import { Application } from "./app.ts";
import { DefaultBotAvatar } from "./constant.ts";
import { nostr } from "./deps.ts";

export async function handleBotMessage(e: nostr.Event, app: Application) {
  const message = await app.bot!.decrypt(e);
  const match = message.match(/^\/[a-z0-9_]+/);
  if (!match) return;

  switch (match[0].slice(1)) {
    case "stat":
      if (e.pubkey !== app.nip11.pubkey) return;
      return await app.report(
        Object.entries(await app.repo.status()).map((i) => `${i[0]}: ${i[1]}`)
          .join("\n"),
      );
    case "event": {
      if (e.pubkey !== app.nip11.pubkey) return;
      if (message.length !== 71) {
        return await app.report("Unvalid params");
      }
      const id = message.slice(-64);
      const arr = await app.repo.query({ ids: [id] });
      if (!arr.length) {
        return await app.report("Not found");
      }

      return await app.report(JSON.stringify(arr[0]));
    }
    case "help":
      return await app.bot!.help(e.pubkey);
    case "balance": {
      try {
        const data = await app.repo.pubkeyInfo(e.pubkey);
        return await app.bot!.send(
          e.pubkey,
          `Your balance is: ${Number(data.balance / 1000n)} Sats`,
        );
      } catch {
        return await app.bot!.send(e.pubkey, "Your balance is: 0 Sat");
      }
    }
    default:
      return await app.report("Unknown command: " + match[0]);
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
      created_at: ~~(Date.now() / 1000),
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

  help(pubkey: string) {
    return this.send(
      pubkey,
      pubkey === this.app.nip11.pubkey
        ? `Commands:

/stat Show relay status.
/event [id] Show event JSON.
/help Show help message.
/balance Show your balance.`
        : `Commands:

/help Show help message.
/balance Show your balance.`,
    );
  }
}
