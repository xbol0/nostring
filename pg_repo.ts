import { hex, pg } from "./deps.ts";
import { DataAdapter, NostrEvent, RawEvent, ReqParams } from "./types.ts";

export class PgRepository implements DataAdapter {
  pool: pg.Pool;

  constructor(url: string) {
    this.pool = new pg.Pool(url, 10);
  }

  async init() {
    await this.use(async (db) => {
      await db.queryArray(
        "create table if not exists migrations(name text primary key,created_at timestamp default current_timestamp)",
      );

      const res = await db.queryArray<[BigInt]>(
        "select count(*) from migrations",
      );
      const migs = [this.m202302131450].slice(Number(res.rows[0][0]));

      for (const fn of migs) {
        await fn(db);
        await db.queryArray(
          "insert into migrations(name) values ($1)",
          [fn.name],
        );
      }

      console.log("migrations finished");
    });
  }

  async use<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      return await fn(db);
    } finally {
      db.release();
    }
  }

  async close() {
    await this.pool.end();
  }

  async insertEvent(e: NostrEvent) {
    await this.use((db) =>
      db.queryArray(
"insert into events(id,pubkey,kind,created_at,content,tags,sig,expires_at) \
        values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing",
        [
          hex.decode(e.id),
          hex.decode(e.pubkey),
          e.kind,
          new Date(e.created_at * 1000),
          e.content,
          JSON.stringify(e.tags),
          hex.decode(e.sig),
          e.expires_at ? new Date(e.expires_at * 1000) : null,
        ],
      )
    );
  }

  async query(params: ReqParams & { skip?: number }) {
    return await this.use(async (db) => {
      const sqlPart: string[] = [],
        args: Record<string, unknown> = { limit: 100, skip: 0 };

      if (params.ids) {
        sqlPart.push("id=any($ids)");
        args.ids = params.ids.map((i) => "\\x" + i);
      }

      if (params.authors) {
        sqlPart.push("pubkey=any($authors)");
        args.authors = params.authors.map((i) => "\\x" + i);
      }

      if (params.kinds) {
        sqlPart.push("kind=any($kinds)");
        args.kinds = params.kinds;
      }

      if (params.since) {
        sqlPart.push("created_at > $since");
        args.since = new Date(params.since * 1000);
      }

      if (params.until) {
        sqlPart.push("created_at < $until");
        args.until = new Date(params.until * 1000);
      }

      if (params.search) {
        sqlPart.push("content like $search");
        args.search = `%${params.search}%`;
      }

      if (params.limit && params.limit > 0 && params.limit < 100) {
        args.limit = params.limit;
      }

      if (params.skip) args.skip = params.skip;

      // NIP-12
      for (const [k, v] of Object.entries(params)) {
        if (k[0] !== "#") continue;
        if (!(v instanceof Array)) continue;
        if (!(v as string[]).every((i) => typeof i === "string")) continue;

        const key = k.slice(1);
        sqlPart.push("tags @> $" + key);
        args[key] = JSON.stringify(v.map((i) => [key, i]));
      }

      const sql =
        "select id,kind,created_at,content,pubkey,sig,tags from events where " +
        sqlPart.join(" and ") +
        " and (expires_at>current_timestamp or expires_at is null) and deleted_at is null" +
        " order by created_at desc limit $limit offset $skip";
      console.log(sql, args);

      try {
        const res = await db.queryObject<RawEvent>(sql, args);
        return res.rows.map((i) => ({
          ...i,
          id: hex.encode(i.id),
          pubkey: hex.encode(i.pubkey),
          sig: hex.encode(i.sig),
          delegator: undefined,
        }));
      } catch (err) {
        console.error(err);
        throw err;
      }
    });
  }

  async delete(ids: string[], author: string) {
    await this.use(async (db) => {
      // NIP-09
      await db.queryArray(
        "update events set deleted_at=current_timestamp where pubkey=$1 and id=any($2)",
        [hex.decode(author), ids.map((i) => "\\x" + i)],
      );
    });
  }

  async replaceEvent(e: NostrEvent) {
    await this.use(async (db) => {
      const tx = db.createTransaction("tx_replace_event_" + e.id);
      await tx.begin();

      const sqls = ["pubkey=$1", "kind=$2"],
        args: unknown[] = [hex.decode(e.pubkey), e.kind];
      if (e.kind >= 30000 && e.kind < 40000) {
        // NIP-33
        sqls.push("tags @> $3");
        const f = e.tags.find((i) => i[0] === "d");
        const d = f ? f[1] || "" : "";
        args.push(JSON.stringify(["d", d]));
      }
      const sql = `select id,created_at from events where ${
        sqls.join(" and ")
      } and (expires_at>current_timestamp or expires_at is null) and deleted_at is null for update`;
      console.log(sql, args);
      const res = await tx.queryArray<[Uint8Array, Date]>(sql, args);

      console.log("replace111", res.rows);
      if (res.rows.length) {
        if (~~(res.rows[0][1].getTime() / 1000) < e.created_at) {
          await tx.queryArray("delete from events where id=$1", [
            res.rows[0][0],
          ]);
        } else {
          await tx.commit();
          return;
        }
      }

      await tx.queryArray(
"insert into events(id,pubkey,kind,created_at,content,tags,sig,expires_at) \
        values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing",
        [
          hex.decode(e.id),
          hex.decode(e.pubkey),
          e.kind,
          new Date(e.created_at * 1000),
          e.content,
          JSON.stringify(e.tags),
          hex.decode(e.sig),
          e.expires_at ? new Date(e.expires_at * 1000) : null,
        ],
      );

      await tx.commit();
    });
  }

  async m202302131450(db: pg.PoolClient) {
    await db.queryArray(
      "create table if not exists events (id bytea primary key,pubkey bytea not null,created_at timestamp not null,kind int not null,tags jsonb,content text not null,sig bytea not null,expires_at timestamp default null,deleted_at timestamp default null)",
    );
    await db.queryArray(
      "create index if not exists pubkey_idx on events (pubkey)",
    );
    await db.queryArray(
      "create index if not exists created_at_idx on events (created_at)",
    );
    await db.queryArray(
      "create index if not exists kind_idx on events (kind)",
    );
    await db.queryArray(
      "create index if not exists tags_idx on events (tags)",
    );
  }
}
