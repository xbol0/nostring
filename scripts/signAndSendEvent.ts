import { nostr } from "../deps.ts";

function help() {
  console.log(
    `usage: deno task sign <event json> [relay] [private key] 
  if skip private key, will read from env NOSTR_KEY 
  if skip relay, only print the event without send`,
  );
}

if (Deno.args.length > 3 || Deno.args.length < 1) {
  help();
  Deno.exit(1);
}

const key = Deno.args[2] || Deno.env.get("NOSTR_KEY") || "";
const data = nostr.finishEvent(JSON.parse(Deno.args[0]), key);
const relay = Deno.args[1] || "";

if (!key || !key.match(/^[a-f0-9]{64}$/)) {
  console.error("Invalid private key");
  Deno.exit(1);
}

console.log("Event data:");
console.log(JSON.stringify(data));

if (!relay) Deno.exit();
if (!relay.match(/^wss?:\/\//)) {
  console.error("Invalid relay url");
  Deno.exit(1);
}

const ws = new WebSocket(relay);
ws.onerror = (e) => {
  console.error(e);
  Deno.exit(1);
};
ws.onmessage = (e) => {
  console.log(e.data);
  const json = JSON.parse(e.data);
  if (!json[2]) {
    console.error(json[3]);
    ws.close();
    Deno.exit(2);
  }
  ws.close();
};
ws.onopen = () => {
  ws.send(JSON.stringify(["EVENT", data]));
};
