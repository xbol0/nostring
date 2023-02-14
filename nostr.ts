import { NostrEvent } from "./types.ts";
import { encoder, secp256k1 } from "./deps.ts";

export function isEvent(ev: NostrEvent): ev is NostrEvent {
  if (typeof ev !== "object") return false;
  if (!ev) return false;
  if (!("id" in ev) || typeof ev.id !== "string") return false;
  if (!("pubkey" in ev) || typeof ev.pubkey !== "string") return false;
  if (!("content" in ev) || typeof ev.content !== "string") return false;
  if (!("sig" in ev) || typeof ev.sig !== "string") return false;
  if (!("created_at" in ev) || typeof ev.created_at !== "number") return false;
  if (!("kind" in ev) || typeof ev.kind !== "number") return false;
  if (!("tags" in ev) || !(ev.tags instanceof Array)) return false;

  if (!/^[a-f0-9]{64}$/.test(ev.id)) return false;
  if (!/^[a-f0-9]{64}$/.test(ev.pubkey)) return false;
  if (!/^[a-f0-9]{128}$/.test(ev.sig)) return false;

  return true;
}

export function serializeEvent(ev: NostrEvent): string {
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

export async function validateEvent(ev: NostrEvent) {
  if (typeof ev.content !== "string") return false;
  if (typeof ev.created_at !== "number") return false;
  if (typeof ev.pubkey !== "string") return false;
  if (!ev.pubkey.match(/^[a-f0-9]{64}$/)) return false;

  if (!Array.isArray(ev.tags)) return false;
  for (let i = 0; i < ev.tags.length; i++) {
    const tag = ev.tags[i];
    if (!Array.isArray(tag)) return false;
    for (let j = 0; j < tag.length; j++) {
      if (typeof tag[j] === "object") return false;
    }
  }

  return await secp256k1.schnorr.verify(
    ev.sig,
    await getEventHash(ev),
    ev.pubkey,
  );
}

export async function getDelegator(event: NostrEvent) {
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

  return pubkey;
}
