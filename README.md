# Nostring

**WIP**

A simple pure [Nostr](https://github.com/nostr-protocol/nostr) relay written in Deno.

## Features

- Can deployed on [Deno Deploy](https://deno.com/deploy)
- Internal forward events by BroadcastChannel(Only on Deno Deploy)
- Multi data store provider(WIP)
  - [x] PostgreSQL
- Programmable
- Supported NIPs
  - 01 02 04 09 11 12 15 16 20 26 28 33 40 56

## Requirements

- Deno ^1.30.0
- PostgreSQL 15 (Other database support is WIP)

## Configure environments

All variables are optional.

- `DB_URL` defaults postgres://localhost:5432/nostring
- `PORT` defaults 9000
- `RELAY_NAME` NIP-11 name field
- `RELAY_DESC` NIP-11 description field
- `ADMIN_PUBKEY` NIP-11 pubkey field
- `RELAY_CONTACT` NIP-11 contact field
- `MIN_POW` NIP-13 min pow

## Usage

```
deno task start
```

## Use as a library

```ts
// Your init code...
import { Application } from "./app.ts"
const app = new Application();

// handle a request
const res = Deno.upgradeWebSocket(req)
app.addSocket(res.socket)

```

