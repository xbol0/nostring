import { Application } from "./app.ts";
import { bolt, hex, lnurl, nostr } from "./deps.ts";

export async function handlePayment(app: Application, event: nostr.Event) {
  try {
    if (!await app.payment!.verify(event)) {
      throw new Error("Unverified payment invoice.");
    }

    const bolt11 = event.tags.find((i) => i[0] === "bolt11")!;
    const ph = app.payment!.getHash(bolt11[1]);

    await app.repo.resolveInvoice(ph);

    await app.bot!.send(event.pubkey, "Payment received, thanks for your Zap.");
  } catch (e) {
    console.error(e);
    app.report("Payment Error: " + e.message);
  }
}

export class LnurlPayment {
  app: Application;
  lnurl: string;
  payParams: lnurl.LNURLPayParams | null = null;
  pubkey = "";

  constructor(app: Application) {
    this.app = app;
    this.lnurl = app.env.PAYMENT_LNURL;
  }

  async init() {
    const p = await lnurl.getParams(this.lnurl);
    if (!("callback" in p)) {
      throw new Error("Invalid LNURL");
    }

    if (p.tag !== "payRequest") {
      throw new Error("Invalid payRequest LNURL");
    }

    if (
      "nostrPubkey" in p && typeof p.nostrPubkey === "string" &&
      /^[0-9a-f]{64}$/.test(p.nostrPubkey)
    ) {
      this.pubkey = p.nostrPubkey;
    } else {
      throw new Error("Not supported nostr zap");
    }

    this.payParams = p;
  }

  getHash(pr: string) {
    const obj = bolt.decode(pr);
    const payment_hash = obj.tagsObject.payment_hash;

    if (!payment_hash) throw new Error("Invalid payment request");
    return payment_hash;
  }

  async create(amount: number) {
    if (!this.payParams) await this.init();
    const url = `${this.payParams?.callback}?amount=${amount}&comment=${
      encodeURIComponent("Pay for " + this.app.nip11.name)
    }`;
    const res = await fetch(url);
    const json = await res.json();
    const bolt11 = json.pr as string;
    const obj = bolt.decode(bolt11);
    const payment_hash = obj.tagsObject.payment_hash;
    const expiry = new Date(
      obj.timeExpireDate ? obj.timeExpireDate * 1000 : Date.now() + 86400,
    );

    if (!payment_hash) throw new Error("Invalid payment request");
    return { bolt11, payment_hash, expiry };
  }

  async verify(e: nostr.Event) {
    if (e.kind !== 9735) return false;
    if (e.pubkey !== this.pubkey) return false;

    const bolt11Tag = e.tags.find((i) => i[0] === "bolt11");
    if (!bolt11Tag) return false;

    const preimageTag = e.tags.find((i) =>
      i.length >= 2 && i[0] === "preimage" && /^[0-9a-f]{64}$/.test(i[1])
    );
    if (!preimageTag) return false;

    const bolt11Obj = bolt.decode(bolt11Tag[1]);
    const ph = bolt11Obj.tags.find((i) => i.tagName === "payment_hash");
    if (!ph) return false;

    if (
      bolt11Obj.timeExpireDate &&
      bolt11Obj.timeExpireDate < ~~(Date.now() / 1000)
    ) return false;

    const hash = await crypto.subtle.digest(
      "SHA-256",
      hex.decode(preimageTag[1]),
    );

    if (ph.data != hex.encode(new Uint8Array(hash))) {
      return false;
    }

    return true;
  }
}
