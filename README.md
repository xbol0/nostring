# Nostring

A simple [Nostr](https://github.com/nostr-protocol/nostr) relay library written in Deno.

## Features

- Pure Nostr relay core
- Multi data store provider(WIP)
  - [x] PostgreSQL
- Supported NIPs
  - 01 02 04 09 11 12 15 16 20 26 28 33 40 56

## Requirements

- Deno ^1.30.0
- PostgreSQL 15 (Other database support is WIP)

## Usage

Run directly

```
deno task start
```

## Use as a library

```ts
import { Application, upgradeFn, PgRepository } from "https://deno.land/x/nostring/mod.ts"
import { serve } from "https://deno.land/std/http/server.ts"

// Your init code...
const db = new PgRepository("YOUR DB URL")
await db.init();

const app = new Application({
  // REQUIRED, a function convert Request to WebSocket Response
  // You can use Deno default, or another function
  upgradeWebSocketFn: upgradeFn,

  // REQUIRED, an implement of DataAdapter
  db,

  // optional, callback of new connection request
  // you can block a connection with throw an Error
  onConnect: (ws, req) => {},

  // optional, callback of new Event has been validated
  onEvent: (ev, ws) => {},

  // optional, callback of client send an auth Event and validated
  onAuth: (ev, ws) => {},

  // optional, callback of new REQ subscription
  onReq: (id, filters, ws) => {},

  // optional, callback of an Event will be send to client
  onStream: (e, id, ws) => {},

  // optional, name of this relay
  // if empty will sent hostname
  name: "",

  // optional, description of this relay
  description: "",

  // optional, pubkey of relay's owner
  pubkey: "",

  // optional, alternative contact of relay's owner
  contact: "",

  // optional, min PoW of NIP-13, default 0
  minPow: 0,
});

// Serve

serve(app.getHandler(), { port: 9000 })
```

