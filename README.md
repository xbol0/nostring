# Nostring

**WIP**

A simple [Nostr](https://github.com/nostr-protocol/nostr) relay written in Deno.

## Features

- Can deployed on [Deno Deploy](https://deno.com/deploy)
- Internal forward events by BroadcastChannel(Only on Deno Deploy)
- Multi data store provider(WIP)
  - [x] PostgreSQL
- Filter spam messages
  - [x] https://spam.nostr.band/spam_api?method=get_current_spam
- Relay administration
- Supported NIPs
  - [x] 01
  - [x] 02
  - [ ] 03
  - [x] 04
  - [x] 05
  - [x] 09
  - [x] 11
  - [x] 12
  - [x] 13
  - [x] 15
  - [x] 16
  - [x] 20
  - [x] 22
  - [x] 26
  - [x] 28
  - [x] 33
  - [x] 40
  - [ ] 56
  - [ ] 57

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

## NIP-05 usage

Everyone can sign an event to this relay for register a NIP-05 name, 
a pubkey only can register one, you can delete the old to change, 
the name should be match /[a-z0-9_]{4,}/i, eg.

```js
{
  "id": "<event id>",
  "kind": 23305,
  // ...
  "content": "+your_name", // register
  "content": "-your_name", // shutdown
}
```

## Thanks

[nostr.band](https://nostr.band/) provide spam keyword list
