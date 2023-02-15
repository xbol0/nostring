import { nextTick } from "./deps.ts";
import { getDelegator, isEvent, validateEvent } from "./nostr.ts";
import { db } from "./repo.ts";
import type {
  ClientAuthMessage,
  ClientCloseMessage,
  ClientEventMessage,
  ClientMessage,
  ClientReqMessage,
  NostrEvent,
  ReqParams,
  Subinfo,
} from "./types.ts";
import { channel } from "./broadcast_channel.ts";

// TODO: fix websocket subscription mapping
const Subscriptions = new Map<string, Subinfo>();
const AuthChallenges = new Map<WebSocket, string>();

export function append(socket: WebSocket) {
  const subs: string[] = [];

  socket.addEventListener("error", (ev) => {
    console.error(ev);
    socket.close();
    for (const i of subs) Subscriptions.delete(i);
  });

  socket.addEventListener("close", () => {
    for (const i of subs) Subscriptions.delete(i);
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
        return handleReqMessage(data, socket, (s) => subs.push(s));
      case "CLOSE":
        return handleCloseMessage(data, socket);
      case "AUTH":
        return handleAuthMessage(data, socket);
      case "EVENT":
        return handleEventMessage(data, socket);
      default:
        return;
    }
  });
}

function handleReqMessage(
  msg: ClientReqMessage,
  socket: WebSocket,
  bindSub: (s: string) => void,
) {
  if (typeof msg[1] !== "string") return;
  const filters = msg.slice(2).filter((i) =>
    typeof i === "object"
  ) as ReqParams[];
  if (filters.length === 0) return;

  if (Subscriptions.has(msg[1])) {
    socket.send(JSON.stringify(["EOSE", msg[1]]));
    return;
  }

  Subscriptions.set(msg[1], { socket, filters, sendCount: 0 });
  bindSub(msg[1]);

  for (const item of filters) {
    nextTick(() => handleReq(msg[1], socket, item));
  }
}

function handleCloseMessage(msg: ClientCloseMessage, socket: WebSocket) {
  if (typeof msg[1] !== "string") return;

  const sub = Subscriptions.get(msg[1]);
  if (!sub) return;

  if (sub.socket !== socket) return;
  Subscriptions.delete(msg[1]);
}

async function handleEventMessage(msg: ClientEventMessage, socket: WebSocket) {
  const ev = msg[1];
  if (!isEvent(ev)) return;

  if (!await validateEvent(msg[1])) {
    return socket.send(
      JSON.stringify(["OK", ev.id, false, "invalid: validate event fail"]),
    );
  }

  // NIP-26
  try {
    await getDelegator(ev);
  } catch (err) {
    return socket.send(
      JSON.stringify(["OK", ev.id, false, "invalid: " + err.message]),
    );
  }

  // NIP-22
  const now = ~~(Date.now() / 1000);
  if (ev.created_at > now + 15 * 60 || ev.created_at < now - 30 * 60) {
    return socket.send(
      JSON.stringify([
        "OK",
        ev.id,
        false,
        "invalid: the event created_at field is out of the acceptable range (-30min, +15min) for this relay",
      ]),
    );
  }

  // NIP-16
  if (ev.kind < 10000) {
    // NIP-40
    const f = ev.tags.find((i) => i[0] === "expiration");
    if (f) ev.expires_at = +f[1];

    // NIP-01
    if (ev.kind === 0) {
      await db.replaceEvent(ev);
      console.log(`usermeta ${ev.pubkey} stored`);
    } else {
      await db.insertEvent(ev);
      console.log(`${ev.id} stored`);
    }

    // NIP-09 event deletion
    if (ev.kind === 5) {
      console.log(`DELETE REASON: ${ev.content}`);

      const list = ev.tags.filter((i) => i[0] === "e").map((i) => i[1]);
      await db.delete(list, ev.pubkey);
    }
  } else if (ev.kind >= 10000 && ev.kind < 20000) {
    await db.replaceEvent(ev);
  } else if (ev.kind >= 20000 && ev.kind < 30000) {
    // Ephemeral Events, no store
    console.log(`${ev.id} kind=${ev.kind} no store`);
  } else if (ev.kind >= 30000 && ev.kind < 40000) {
    // NIP-33
    await db.replaceEvent(ev);
  }

  socket.send(JSON.stringify(["OK", ev.id, true, ""]));

  for (const [id, info] of Subscriptions.entries()) {
    for (const item of info.filters) {
      if (!matchSubscription(ev, item)) continue;
      info.socket.send(JSON.stringify(["EVENT", id, ev]));

      break;
    }
  }

  if (channel) channel.postMessage(ev);
}

if (channel) {
  channel.addEventListener("messageerror", (e) => {
    console.error(e.data);
  });

  channel.addEventListener("message", (e) => {
    console.log("broadcast channel event:", e.data);

    for (const [id, info] of Subscriptions.entries()) {
      for (const item of info.filters) {
        if (!matchSubscription(e.data, item)) continue;
        info.socket.send(JSON.stringify(["EVENT", id, e.data]));

        break;
      }
    }
  });
}

function matchSubscription(ev: NostrEvent, sub: ReqParams) {
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

  for (
    const [k, v] of Object.entries(sub).filter((i) => i[0].startsWith("#"))
  ) {
    const key = k.slice(1);
    const list = ev.tags.filter((i) => i[0] === key).map((i) => i[1]);
    if (!list.length) return false;

    if (!list.some((i) => (v as string[]).includes(i))) return false;
  }

  return true;
}

// NIP-42
async function handleAuthMessage(ev: ClientAuthMessage, socket: WebSocket) {
  if (typeof ev !== "object") return;

  if (ev[1].kind !== 22242) return;
  const stored = ev[1].tags.find((i) => i[0] === "challenge");
  if (!stored) return;
  const challenge = AuthChallenges.get(socket);
  if (stored[1] !== challenge) return;

  try {
    if (!await validateEvent(ev[1])) throw new Error("Unvalidate");

    socket.send(JSON.stringify(["OK", ev[1].id, true, ""]));
  } catch {
    socket.send(
      JSON.stringify(["OK", ev[1].id, false, "restricted: event unvalidated"]),
    );
  } finally {
    AuthChallenges.delete(socket);
  }
}

function verifyData(i: unknown): i is ClientMessage {
  if (!(i instanceof Array)) return false;
  if (
    i[0] !== "REQ" && i[0] !== "EVENT" && i[0] !== "CLOSE" && i[0] !== "AUTH"
  ) return false;

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

async function handleReq(
  id: string,
  socket: WebSocket,
  params: ReqParams & { skip?: number },
) {
  const list = await db.query(params);
  console.log("found", list.length, "events");

  if (list.length) {
    for (const item of list) {
      socket.send(JSON.stringify(["EVENT", id, item]));
    }

    if (params.skip) {
      if (params.skip >= 500) return;
      if (params.limit && params.skip >= params.limit) return;
    }

    if (params.limit && list.length >= params.limit) {
      if (list.length >= params.limit) return;
    }

    const skip = params.skip ? params.skip + list.length : list.length;
    nextTick(() => handleReq(id, socket, { ...params, skip }));
    return;
  } else {
    socket.send(JSON.stringify(["EOSE", id]));
  }
}
