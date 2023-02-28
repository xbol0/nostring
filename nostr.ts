import { ClientMessage, NostrEvent, ReqParams } from "./types.ts";
import { encoder, hex, secp256k1 } from "./deps.ts";

const MSG_TYPES = new Set(["REQ", "CLOSE", "EVENT", "AUTH"]);

export function isEvent(ev: unknown): ev is NostrEvent {
  if (typeof ev !== "object") return false;
  if (!ev) return false;
  if (!("id" in ev) || typeof ev.id !== "string") return false;
  if (!("pubkey" in ev) || typeof ev.pubkey !== "string") return false;
  if (!("content" in ev) || typeof ev.content !== "string") return false;
  if (!("sig" in ev) || typeof ev.sig !== "string") return false;
  if (!("created_at" in ev) || typeof ev.created_at !== "number") return false;
  if (!("kind" in ev) || typeof ev.kind !== "number") return false;
  if (!("tags" in ev) || !Array.isArray(ev.tags)) return false;

  if (!/^[a-f0-9]{64}$/.test(ev.id)) return false;
  if (!/^[a-f0-9]{64}$/.test(ev.pubkey)) return false;
  if (!/^[a-f0-9]{128}$/.test(ev.sig)) return false;

  return true;
}

export function serializeEvent(ev: Omit<NostrEvent, "id" | "sig">): string {
  if (!isEvent(ev)) {
    throw new Error("can't serialize event with wrong or missing properties");
  }

  return JSON.stringify([
    0,
    ev.pubkey,
    ev.created_at,
    ev.kind,
    ev.tags,
    ev.content,
  ]);
}

export async function getEventHash(event: NostrEvent) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(serializeEvent(event)),
  );

  return secp256k1.utils.bytesToHex(new Uint8Array(hash));
}

export async function signEvent(id: string, key: string) {
  return secp256k1.utils.bytesToHex(await secp256k1.schnorr.sign(id, key));
}

export async function validateEvent(ev: NostrEvent, minPow = 0) {
  if (!isEvent(ev)) throw new Error("Invalid event format");

  // NIP-22
  const now = ~~(Date.now() / 1000);
  if (ev.created_at > now + 15 * 60 || ev.created_at < now - 30 * 60) {
    throw new Error("created_at field is out of the acceptable range");
  }

  for (let i = 0; i < ev.tags.length; i++) {
    const tag = ev.tags[i];
    if (!Array.isArray(tag)) throw new Error("Invalid tag format");
    for (let j = 0; j < tag.length; j++) {
      if (typeof tag[j] === "object") throw new Error("Invalid tag value");
    }
  }

  // NIP-13: PoW
  const pow = ev.tags.find((i) => i[0] === "nonce");
  if (minPow && pow) {
    const diff = parseInt(pow[2]);
    if (diff < minPow) throw new Error("PoW less then " + minPow);
    const buf = hex.decode(ev.id.slice(0, Math.ceil(diff / 8) * 2));
    const str = [...buf].map((i) => i.toString(2).padStart(8, "0")).slice(diff);
    if (!str.every((i) => i === "0")) throw new Error("PoW invalid");
  }

  // NIP-26
  await checkDelegator(ev);

  if (
    !await secp256k1.schnorr.verify(ev.sig, await getEventHash(ev), ev.pubkey)
  ) {
    throw new Error("Invalid signature");
  }
}

export async function checkDelegator(event: NostrEvent) {
  // find delegation tag
  const tag = event.tags.find((tag) =>
    tag[0] === "delegation" && tag.length >= 4
  );
  if (!tag) return null;

  const [_, pubkey, cond, sig] = tag;

  // check conditions
  const conditions = cond.split("&");
  let anyKindsMatch = false;
  for (let i = 0; i < conditions.length; i++) {
    const [key, operator, value] = conditions[i].split(/\b/);

    // the supported conditions are just 'kind' and 'created_at' for now
    if (key === "kind" && operator === "=" && event.kind === parseInt(value)) {
      anyKindsMatch = true;
    } else if (
      key === "created_at" &&
      operator === "<" &&
      event.created_at > parseInt(value)
    ) {
      return null;
    } else if (
      key === "created_at" &&
      operator === ">" &&
      event.created_at < parseInt(value)
    ) {
      return null;
    }
  }

  if (!anyKindsMatch) return null;

  // check signature
  const sighash = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`nostr:delegation:${event.pubkey}:${cond}`),
  );
  if (!await secp256k1.schnorr.verify(sig, new Uint8Array(sighash), pubkey)) {
    throw new Error("Delegation signature unverified");
  }
}

export function checkMsg(i: unknown): i is ClientMessage {
  if (!(i instanceof Array)) return false;
  if (!MSG_TYPES.has(i[0])) return false;

  if (i[0] === "REQ") {
    if (typeof i[1] !== "string") return false;
    if (i.length < 3) return false;
    if (i.slice(2).some((i) => typeof i !== "object" || i === null)) {
      return false;
    }
  }

  if (i[0] === "CLOSE" && typeof i[1] !== "string") return false;
  if (i[0] === "AUTH" && !isEvent(i[1])) return false;
  if (i[0] === "EVENT" && !isEvent(i[1])) return false;

  return true;
}

export function match(ev: NostrEvent, sub: ReqParams) {
  if (sub.authors && !sub.authors.find((i) => ev.pubkey.startsWith(i))) {
    return false;
  }

  if (sub.ids && !sub.ids.find((i) => ev.id.startsWith(i))) {
    return false;
  }

  if (sub.kinds && !sub.kinds.includes(ev.kind)) {
    return false;
  }

  if (sub.since && sub.since > ev.created_at) {
    return false;
  }

  if (sub.until && sub.until < ev.created_at) {
    return false;
  }

  const collections = Object.entries(sub).filter((i) => i[0].startsWith("#"));
  for (const [k, v] of collections) {
    const key = k.slice(1);
    const list = ev.tags.filter((i) => i[0] === key).map((i) => i[1]);
    if (!list.length) return false;

    if (!list.some((i) => (v as string[]).includes(i))) return false;
  }

  return true;
}

export function getExpires(e: NostrEvent) {
  const expires = e.tags.find((i) => i[0] === "expiration");
  let expiresTimestamp: number | null = null;
  if (expires) {
    expiresTimestamp = parseInt(expires[1]);
    if (expiresTimestamp <= 0) throw new Error("Invalid expires timestamp");
    if (expiresTimestamp < ~~(Date.now() / 1000)) {
      throw new Error("Event expired");
    }
  }
  return expiresTimestamp;
}
