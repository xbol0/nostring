import { Application } from "./app.ts";
import { BotAboutTemplate, DefaultBotAvatar } from "./constant.ts";
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
    case "note": {
      const content = message.slice(6);
      const e = nostr.finishEvent({
        content,
        created_at: ~~(Date.now() / 1000),
        kind: 1,
        tags: [],
      }, app.bot!.key);

      await app.repo.save(e);
      app.notify(e);
      return app.broadcast(e);
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
      kinds: [0, 2, 10002],
      authors: [pubkey],
      limit: 3,
    });

    let hasModified = false;

    const meta = list.find((i) => i.kind === 0);

    if (!meta) {
      await this._updateMeta();
      hasModified = true;
    } else {
      const data = JSON.parse(meta.content) as Record<string, string>;
      if (
        data.name !== this.meta.name || data.picture !== this.meta.picture ||
        data.username !== this.meta.username ||
        data.lud06 !== this.app.payment?.lnurl
      ) {
        await this._updateMeta();
        hasModified = true;
      }
    }

    const relays = list.find((i) => i.kind === 2);
    if (!relays) {
      await this._updateRelays();
      hasModified = true;
    } else {
      const data = JSON.parse(relays.content);
      if (!(this.app.env.BOT_RELAY in data)) {
        await this._updateRelays();
        hasModified = true;
      }
    }

    if (hasModified) {
      console.log("Update bot information success");
      await this.app.report("Bot metadata updated.");
    }
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

  async _updateMeta() {
    const e = nostr.finishEvent({
      created_at: ~~(Date.now() / 1000),
      kind: 0,
      tags: [],
      content: JSON.stringify({
        ...this.meta,
        about: BotAboutTemplate.replaceAll("%NAME%", this.app.nip11.name)
          .replaceAll("%URL%", this.app.env.BOT_RELAY),
        lud06: this.app.payment?.lnurl || "",
      }),
    }, this.key);
    await this.app.repo.save(e);
    this.app.notify(e);
    this.app.broadcast(e);
  }

  async _updateRelays() {
    const now = ~~(Date.now() / 1000);
    const e = nostr.finishEvent({
      created_at: now,
      kind: 2,
      tags: [],
      content: JSON.stringify({
        [this.app.env.BOT_RELAY]: { read: true, write: true },
      }),
    }, this.key);
    await this.app.repo.save(e);
    this.app.notify(e);
    this.app.broadcast(e);

    const e2 = nostr.finishEvent({
      created_at: now,
      kind: 10002,
      tags: [["r", this.app.env.BOT_RELAY]],
      content: "",
    }, this.key);
    await this.app.repo.save(e2);
    this.app.notify(e2);
    this.app.broadcast(e2);
  }

  help(pubkey: string) {
    return this.send(
      pubkey,
      pubkey === this.app.nip11.pubkey
        ? `Commands:

/stat Show relay status.
/event [id] Show event JSON.
/note [content] Publish a note via Bot.
/help Show help message.
/balance Show your balance.`
        : `Commands:

/help Show help message.
/balance Show your balance.`,
    );
  }
}
