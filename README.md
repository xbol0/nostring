# Nostring

[Nostr](https://github.com/nostr-protocol/nostr) relay written in Deno.

You can easily host a relay by [Deno Deploy](https://deno.com/deploy) and [Bit.io](https://bit.io/).

## Features

- PostgreSQL database
- Spam filter
- Relay Bot
- Zap for admission

## Usage

Configure you environments or create a `.env` file.
More details are below.

And then:

```bash
deno run --allow-net --allow-read --allow-env \
  https://deno.land/x/nostring/scripts/start.ts
```

Or you can clone this repo and start manually:

```bash
git clone https://github.com/xbol0/nostring
cd nostring
deno task start
```

## Environment configuration

| Name | Required | Description | Default |
|:-:|:-:|:-|:-:|
|DB_URL|yes|PostgreSQL connect URL||
|PORT|no|HTTP server listen port|`9000`|
|DB_POOL_SIZE|no|Database client connection pool size|`3`|
|RELAY_NAME|no, recommanded|NIP-11 Relay name|`nostring`|
|RELAY_DESC|no|NIP-11 Relay desciption||
|ADMIN_PUBKEY|no, recommanded|NIP-11 Relay admin pubkey, hex encoding. Would be used for bot if enabled.||
|RELAY_COUNTRIES|no|NIP-11 Relay countries||
|ENABLE_BROADCASTCHANNEL|no|Enable [BraodcastChannel on Deno Deploy](https://deno.com/deploy/docs/runtime-broadcast-channel)||
|ENABLE_ALLOW_UNKNOWN_KIND|no|Enable save unknown kind events||
|DISABLE_NIP11|no|Disable handle NIP-11 request||
|SPAM_DETECT_PERCENT|no|Setup spam filter detect percentage, 0 to disable spam filter|`0.5`|
|BOT_KEY|no, yes if enabled payment|Bot private key, in hex encoding, if you enabled payment for relay, you should setup this||
|BOT_NAME|no|Bot name|You relay's name + `'s bot`|
|BOT_AVATAR|no|Bot picture|`https://media-uploader.orzv.workers.dev/pomf2.lain.la/f/m4lnneh4.png`|
|BOT_RELAY|no, yes if enabled payment|You bot relay list||
|MAX_MESSAGE_LENGTH|no|Max message length per websocket send|`393216` -> 384KB|
|MAX_SUBSCRIPTIONS|no|Max subscriptions per connection|`32`|
|MAX_FILTER|no|Max filters per REQ subscription|`10`|
|MAX_LIMIT|no|Max limit per filter|`500`|
|MAX_SUBID_LENGTH|no|Max subscription id length|`64`|
|MIN_PREFIX|no|Min prefix for ids and authors param|`32`|
|MAX_EVENT_TAGS|no|Max tags per event|`2048`|
|MAX_CONTENT_LENGTH|no|Max content length per event|`102400` -> 100KB|
|MIN_POW_DIFFICULTY|no|Min NIP-13 PoW diffieculty|`0`|
|AUTH_REQUIRED|no|Need auth for access||
|PAYMENT_REQUIRED|no|Need pay for access||
|NIPS|no|NIP-11 supported nips|`1,9,11,12,13,15,16,20,22,26,33,40,42`|
|EVENT_RETENTION|no|NIP-11 event retention, in JSON format|`[{"kinds":[1,4],"time":31536000,"count":5000},{"kinds":[6,7],"count":10000},{"kinds":[0,2,3],"count":1},{"count":1000}]`|
|EVENT_TIMESTAMP_RANGE|no|NIP-22 timestamp accepted range|`-86400~300` -> one day ago to 5 minites later|
|BROADCAST_RELAYS|no|Events broadcast to other relays, seperated by comma||
|WHITELIST_PUBKEYS|no|Whitelist pubkeys, seperated by comma||
|LANGUAGE_TAGS|no|NIP-11 language tags||
|TAGS|no|NIP-11 tags||
|POSTING_POLICY|no|NIP-11 posting policy url||
|PAYMENT_LNURL|no|Payment LNURL||
|FEES_ADMISSION|no|Fees for admission, unit sats, eg. `1000,2000,3000`||
|FEES_SUBSCRIPTION|no|Fees for subscription, unit sats, eg. `1000/2592000,2000/31536000`||
|FEES_PUBLICATION|no|Fees for publication, unit sats, eg. `1,2,3:10,4,10000:100`||

