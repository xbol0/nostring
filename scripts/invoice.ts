import { lnurl, nostr } from "../deps.ts";

function help() {
  console.log(
    `usage: deno task invoice <amount>
  if skip private key, will read from env NOSTR_KEY 
  if skip relay, only print the event without send`,
  );
}

if (Deno.args.length !== 1) {
  help();
  Deno.exit(1);
}

const key = Deno.env.get("BOT_KEY") || "";
const botPubkey = nostr.getPublicKey(key);
console.log("bot pubkey", botPubkey);
const amount = parseInt(Deno.args[0] || "1") * 1000;
const event = nostr.finishEvent({
  kind: 9734,
  created_at: ~~(Date.now() / 1000),
  content: "",
  tags: [["p", botPubkey], ["amount", amount.toString()], [
    "relays",
    "wss://tring2.deno.dev",
    "wss://relay.damus.io",
  ]],
}, key);
const ln = Deno.env.get("PAYMENT_LNURL") || "";
if (!ln) {
  console.error("Invalid LNURL");
  Deno.exit(1);
}

const lnobj = await lnurl.getParams(ln);
if (!("callback" in lnobj)) {
  console.error("invalid lnurl");
  Deno.exit(1);
}

if (lnobj.tag !== "payRequest") {
  console.error("Not a payrequest lnurl");
  Deno.exit(1);
}
const param = new URLSearchParams({
  amount: amount.toString(),
  nostr: JSON.stringify(event),
});
console.log(param.toString());

// const res = await fetch(lnobj.callback + "?" + param.toString());
// const json = await res.json();
// console.log(json.pr);
