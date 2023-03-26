import { Application } from "./app.ts";
import { nostr } from "./deps.ts";

export async function handleBotMessage(e: nostr.Event, app: Application) {
  const message = await nostr.nip04.decrypt(app.botKey, e.pubkey, e.content);
  console.log("Admin message", message);

  const match = message.match(/^\/[a-z0-9_]+/);
  if (!match) return;

  const cmd = match[0];
  switch (cmd.slice(1)) {
    case "stat":
      return await app.report("hello");
    default:
      return await app.report("Unknown command: " + cmd);
  }
}
