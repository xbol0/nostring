# Nostring

A simple [Nostr](https://github.com/nostr-protocol/nostr) relay library written in Deno.

## Usage

Run directly for a simplest relay:

```
export DB_URL=postgres://your-postgres-url
deno task start
```

## Configure

[Example](env.example)

## Use as a library

```ts
import { Application } from "https://deno.land/x/nostring/mod.ts"

// Use a http server to serve your handler
import { serve } from "https://deno.land/std/http/server.ts"

// You should implement a DataAdapter
// or use the example repo
// const repo = new SomeRepo(...)
const db = new PgRepository("YOUR DB URL")
await db.init();

const app = new Application({
  // REQUIRED, a function convert Request to WebSocket Response
  // You can use Deno default, or another function
  upgradeWebSocketFn: Deno.upgradeWebSocket,

  // REQUIRED, an implement of DataAdapter
  db,

  // optional, callback of new connection request
  // you can block a connection with throw an Error
  // can be async function
  onConnect: (ws, req) => {
    // Take care, this `ws:WebSocket` currently does not established

    // do something...
    // if you do not want to establish this connection
    // throw an error
    throw new Error("")
  },

  // optional, callback of new connection established
  // If you want to make a whitelist control relay,
  // you can send a AUTH message on this callback
  onEstablished(ws) {
    app.send(ws, ["AUTH", "...your challenge..."])
  },

  // optional, callback of new Event has been validated
  // This callback will be triggered after validate the event,
  // so the event is legal
  async onEvent: (ev, ws) => {
    // can be async

    // If you need to broadcast this event to other instances,
    // you should do it in this callback
    await channel.send(ev)

    // If you do not want to store this event,
    // and prevent the spread to other subscription,
    // you can throw an error
    throw new Error("Shutdown!")
  },

  // optional, callback of client send an auth Event and validated
  onAuth: (ev, ws) => {},

  // optional, callback of new REQ subscription
  onReq: (id, filters, ws) => {},

  // optional, callback of an Event will be send to client
  // this callback will triggered before a event respond to a REQ subscription
  onStream: (e, id, ws) => {
    // If you want to block this event to respond client
    // you can return false
    if (e.kind === 1) {
      return false
    }

    return true
  },

  // optional, name of this relay
  name: "",

  // optional, description of this relay
  description: "",

  // optional, pubkey of relay's owner, in hex encoding
  pubkey: "",

  // optional, alternative contact of relay's owner
  contact: "",

  // optional, it can override the whole nip11 json
  nip11: {
    supported_nips: [1, 2, 4],
  },

  // optional, min PoW of NIP-13, default 0
  minPow: 0,
});

// Serve

serve(app.getHandler(), { port: 9000 })

// If you receive an Event from other ways,
// you can broadcast it to the connections which subscribed
app.boradcast(event)
```

## BREAKING updates

~2.0.0 has many breaking features, you should migrate carefully.
