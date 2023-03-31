import { Application } from "./app.ts";
import { FilterItemLimit } from "./constant.ts";
import { bolt, nostr, pg } from "./deps.ts";
import { Repository, User } from "./types.ts";
import { makeCollection } from "./util.ts";

export class PgRepo implements Repository {
  db: pg.Pool;
  app: Application;

  constructor(url: string, app: Application) {
    this.db = new pg.Pool(url, 10, true);
    this.app = app;
  }

  async use<T>(cb: (d: pg.PoolClient) => Promise<T>) {
    const db = await this.db.connect();

    try {
      return await cb(db);
    } finally {
      db.release();
    }
  }

  async init() {
    await this.use((db) => db.queryArray(InitSQL));
  }

  async save(e: nostr.Event) {
    await this.use(async (db) => {
      const dTag = e.tags.find((i) => i[0] === "d")?.[1] || "";
      const delegator = e.tags.find((i) => i[0] === "delegation")?.[1] || null;
      const expiredAt = e.tags.find((i) => i[0] === "expiration")?.[1] || null;

      if (
        e.kind === 0 || e.kind === 3 || e.kind === 2 ||
        (e.kind >= 10000 && e.kind < 20000)
      ) {
        await db.queryArray(
          "delete from events where pubkey=$1 and kind=$2",
          [e.pubkey, e.kind],
        );
      }

      if (e.kind === 5) {
        const ids = e.tags.filter((i) => i[0] === "e").map((i) => i[1]);
        return await db.queryArray(
          "delete from events where id=any($1) and pubkey=$2",
          [ids, e.pubkey],
        );
      }

      if (e.kind >= 30000 && e.kind < 40000) {
        await db.queryArray(
          "delete from events where kind=$1 and pubkey=$2 and dtag=$3",
          [e.kind, e.pubkey, dTag],
        );
      }

      await db.queryArray(
"insert into events (id,kind,pubkey,content,tags,sig,created_at,expired_at,delegator,dtag) values \
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing",
        [
          e.id,
          e.kind,
          e.pubkey,
          e.content,
          JSON.stringify(e.tags),
          e.sig,
          new Date(e.created_at * 1000),
          expiredAt,
          delegator,
          dTag,
        ],
      );
    });

    return await this.cleanup(e.pubkey);
  }

  async query(filter: nostr.Filter) {
    return await this.use(async (db) => {
      const wheres: string[] = [], args: unknown[] = [];
      let i = 1, limit = this.app.limits.maxLimit;

      if (filter.ids && filter.ids.length) {
        if (filter.ids.length > FilterItemLimit) {
          throw new Error("Too many ids");
        }

        const subs: string[] = [];

        for (const item of filter.ids) {
          if (
            this.app.limits.minPrefix && item.length < this.app.limits.minPrefix
          ) {
            throw new Error(
              `Prefix query less than ${this.app.limits.minPrefix}`,
            );
          }
          if (item && item.length > 64) continue;

          subs.push(`id like $${i++}`);
          args.push(`${item}%`);
        }

        if (subs.length) {
          wheres.push(`(${subs.join(" or ")})`);
        }
      }

      if (filter.authors && filter.authors.length) {
        if (filter.authors.length > FilterItemLimit) {
          throw new Error("Too many authors");
        }

        const subs: string[] = [];

        for (const item of filter.authors) {
          if (
            this.app.limits.minPrefix && item &&
            item.length < this.app.limits.minPrefix
          ) {
            throw new Error(
              `Prefix query less than ${this.app.limits.minPrefix}`,
            );
          }
          if (item && item.length > 64) continue;

          subs.push(`pubkey like $${i} or delegator like $${i++}`);
          args.push(`${item}%`);
        }

        if (subs.length) {
          wheres.push(`(${subs.join(" or ")})`);
        }
      }

      if (filter.kinds && filter.kinds.length) {
        if (filter.kinds.length > FilterItemLimit) {
          throw new Error("Too many kinds");
        }

        wheres.push(`kind=any($${i++})`);
        args.push(filter.kinds);
      }

      if (filter.since) {
        wheres.push(`created_at>=$${i++}`);
        args.push(new Date(filter.since * 1000));
      }

      if (filter.until) {
        wheres.push(`created_at<$${i++}`);
        args.push(new Date(filter.until * 1000));
      }

      if (filter.limit) {
        if (filter.limit > 0 && filter.limit <= limit) {
          limit = filter.limit;
        }
      }

      const tagQueries = Object.entries(filter)
        .filter((i) => i[0].startsWith("#") && i[0].length > 1)
        .map((i) => [i[0].slice(1), i[1]]);
      if (tagQueries.length) {
        if (tagQueries.length > 10) {
          throw new Error("Too many tag queries");
        }

        for (const [k, vals] of tagQueries) {
          if ((vals as string[]).length > this.app.limits.maxEventTags) {
            throw new Error("Too many tag values");
          }

          if (!(vals as string[]).length) {
            continue;
          }

          const subs: string[] = [];

          for (const v of vals as string[]) {
            subs.push(`tags @> $${i++}`);
            args.push(JSON.stringify([k, v]));
          }

          wheres.push(`(${subs.join(" or ")})`);
        }
      }

      if (wheres.length === 0) {
        throw new Error("Empty filter");
      }

      return (await db.queryObject<nostr.Event>(
        "select id,kind,pubkey,content,sig,tags,created_at from events where " +
          wheres.join(" and ") +
          ` and (expired_at is null or expired_at>current_timestamp) order by created_at desc limit $${i++}`,
        [...args, limit],
      )).rows;
    });
  }

  async cleanup(pubkey?: string) {
    await this.use(async (db) => {
      // Delete expired events
      await db.queryArray(
        "delete from events where expired_at<current_timestamp",
      );

      if (!pubkey) return;
      if (pubkey && this.app.pubkeys.includes(pubkey)) return;
      if (pubkey === this.app.nip11.pubkey) return;
      if (this.app.botKey && pubkey === nostr.getPublicKey(this.app.botKey)) {
        return;
      }

      // Delete events by event retention rules
      // This rules only effective for non-paying users
      // The data of paying users will be permanently stored.
      for (const item of this.app.retentions) {
        if (!item.time || !item.count) {
          // Time or count should at least one
          continue;
        }

        const kinds = item.kinds ? makeCollection(item.kinds) : [];

        if (item.time) {
          await db.queryArray(
            kinds.length
              ? "delete from events where created_at<$1 and pubkey=$2 and kind in ($3)"
              : "delete from events where created_at<$1 and pubkey=$2",
            kinds.length
              ? [~~(Date.now() / 1000 - item.time), pubkey, item.kinds]
              : [~~(Date.now() / 1000 - item.time), pubkey],
          );
        }

        if (item.count) {
          await db.queryArray(
            kinds.length
              ? "delete from events where pubkey=$1 and kind=$3 and \
created_at<(select created_at from events where pubkey=$1 \
order by created_at desc offset $2 limit 1)"
              : "delete from events where pubkey=$1 and \
created_at<(select created_at from events where pubkey=$1 \
order by created_at desc offset $2 limit 1)",
            kinds.length ? [pubkey, item.count, kinds] : [pubkey, item.count],
          );
        }
      }
    });
  }

  async processPayment(e: nostr.Event) {
    if (e.kind !== 9735) return;
    const desc = e.tags.find((i) => i[0] === "description");
    if (!desc) throw new Error("Not found request event");
    if (typeof desc[1] !== "string") throw new Error("Not found request event");
    const request = JSON.parse(desc[1]) as nostr.Event;
    if (!nostr.verifySignature(request)) throw new Error("Invalid event");
    if (request.kind !== 9734) throw new Error("Not a zap request");

    const bolt11 = e.tags.find((i) => i[0] === "bolt11");
    if (!bolt11) throw new Error("Not found bolt11 tag");
    if (typeof bolt11[1] !== "string") throw new Error("Invalid bolt11");
    const boltObj = bolt.decode(bolt11[1]);
    if (!boltObj.millisatoshis) throw new Error("Invalid bolt11 amount");

    const pubkey = request.pubkey;
    const amount = BigInt(boltObj.millisatoshis);

    await this.use(async (db) => {
      const tx = db.createTransaction("payment:" + e.id);
      await tx.begin();

      const res = await tx.queryObject<User>(
        "select pubkey,balance,admitted_at from pubkeys where pubkey=$1 for update",
        [pubkey],
      );

      const balance = res.rows.length ? res.rows[0].balance : 0n;
      const admitted_at = res.rows.length ? res.rows[0].admitted_at : null;

      await tx.queryArray(
"insert into pubkeys as p (pubkey,balance,admitted_at) \
values ($1,$2,$3) on conflict (pubkey) do update set \
balance=p.balance+$2,admitted_at=$3",
        [
          pubkey,
          amount,
          admitted_at
            ? admitted_at
            : (balance + amount >= this.app.defaultPlan!.amount
              ? new Date()
              : null),
        ],
      );

      await tx.commit();
    });
  }

  async status() {
    return await this.use(async (db) => {
      const res = await db.queryArray(
"select 'total',count(*) from events union \
select 'notes',count(*) from events where kind=1 union \
select 'profiles',count(*) from events where kind=0 union \
select 'DMs',count(*) from events where kind=4 union \
select 'reactions',count(*) from events where kind=7 union \
select 'repost',count(*) from events where kind=6 union \
select 'zap',count(*) from events where kind=9735 union \
select 'channels',count(*) from events where kind=40 union \
select 'reports',count(*) from events where kind=1984 union \
select 'long-form',count(*) from events where kind=30023 union \
select 'rewards',round(sum(balance))::bigint from pubkeys",
      );

      return Object.fromEntries(res.rows.map((i) => [i[0], Number(i[1])]));
    });
  }

  async pubkeyInfo(pubkey: string) {
    return await this.use(async (db) => {
      const res = await db.queryObject<User>(
        "select pubkey,balance,admitted_at from pubkey where pubkey=$1",
        [pubkey],
      );

      if (res.rows.length) throw new Error("not found");
      return res.rows[0];
    });
  }
}

const InitSQL = `
create table if not exists "events" (
  id text not null,
  kind int not null,
  pubkey text not null,
  created_at timestamp not null,
  tags jsonb not null,
  content text not null,
  sig text not null,
  delegator text null,
  expired_at timestamp null,
  dtag text null
);

create unique index if not exists id_idx on events using btree (id text_pattern_ops);
create index if not exists pubkey_idx on events using btree (pubkey text_pattern_ops);
create index if not exists time_idx on events (created_at desc);
create index if not exists kind_idx on events (kind);
create index if not exists tags_idx on events using gin (tags);

create table if not exists "pubkeys" (
  pubkey text primary key,
  balance bigint not null default 0,
  admitted_at timestamp default null
);
`;
