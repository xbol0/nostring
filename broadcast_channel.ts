export let channel: BroadcastChannel | null;

if (typeof BroadcastChannel !== "undefined") {
  channel = new BroadcastChannel("nostr_event");
}
