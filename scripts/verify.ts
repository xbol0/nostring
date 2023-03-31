import { Application } from "../app.ts";
import { LnurlPayment } from "../lnurl.ts";

function help() {
  console.log(
    `usage: deno task verify <event>
  if skip private key, will read from env NOSTR_KEY 
  if skip relay, only print the event without send`,
  );
}

if (Deno.args.length !== 1) {
  help();
  Deno.exit(1);
}

const app = new Application();
await app.repo.init();
const payment = new LnurlPayment(app);
await payment.init();

const e = JSON.parse(Deno.args[0]);
console.log(await payment.verify(e));
await app.repo.processPayment(e);
