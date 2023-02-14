# Nostring

**WIP**

A simple [Nostr](https://github.com/nostr-protocol/nostr) relay written in Deno.

## Features

- Can deployed on [Deno Deploy](https://deno.com/deploy)
- Internal forward events by BroadcastChannel(Only on Deno Deploy)
- Multi data store provider(WIP)
  - [x] PostgreSQL
  - [ ] Deta base
- Supported NIPs
  - [x] 01
  - [x] 02
  - [x] 04
  - [x] 09
  - [x] 11
  - [x] 12
  - [ ] 13
  - [x] 15
  - [x] 16
  - [x] 20
  - [x] 22
  - [x] 26
  - [x] 28
  - [x] 33
  - [x] 40
  - [ ] 111

## Requirements

- Deno ^1.30.0
- PostgreSQL 15 (Other database support is WIP)

## Configure environments

- `DB_URL` REQUIRED, eg. postgres://localhost:5432/nostring
- `PORT` optional, defaults 9000
- `RELAY_NAME` optional, NIP-11 name field
- `RELAY_DESC` optional, NIP-11 description field
- `ADMIN_PUBKEY` optional, NIP-11 pubkey field
- `RELAY_CONTACT` optional, NIP-11 contact field

## Usage

```
deno task start
```

## Roadmap

- [ ] Deta Base data provider
- [ ] NIP-111 support
- [ ] NIP-03 support
- [ ] Relay administration
