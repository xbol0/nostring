import { hex, pg } from "./deps.ts";
import { getExpires } from "./nostr.ts";
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
      const migs = [
        this.m202302131450,
      ].slice(Number(res.rows[0][0]));

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
          getExpires(e),
        ],
      )
    );
  }

  async query(params: ReqParams[]) {
    return await this.use(async (db) => {
      try {
        const res = await db.queryObject<RawEvent>(...makeQuery(params));

        return res.rows.map((i) => ({
          ...i,
          id: hex.encode(i.id),
          pubkey: hex.encode(i.pubkey),
          sig: hex.encode(i.sig),
          created_at: ~~(i.created_at.getTime() / 1000),
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
        args.push(JSON.stringify([["d", d]]));
      }
      const sql = `select id,created_at from events where ${
        sqls.join(" and ")
      } and (expires_at>current_timestamp or expires_at is null) and deleted_at is null for update`;
      const res = await tx.queryArray<[Uint8Array, Date]>(sql, args);

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
          getExpires(e),
        ],
      );

      await tx.commit();
    });
  }

  async getStatistics() {
    return await this.use(async (db) => {
      const res = await db.queryArray(
"select 'total',count(*) from events where deleted_at is null union \
select 'pubkeys',count(distinct pubkey) from events where deleted_at is null union \
select 'notes',count(*) from events where deleted_at is null and kind=1",
      );
      return Object.fromEntries(res.rows.map((i) => [i[0], Number(i[1])]));
    });
  }

  getNip05(name: string) {
    return this.use(async (db) => {
      const res = await db.queryArray<[Uint8Array]>(
        "select pubkey from nip05s where name=$1",
        [name],
      );
      if (!res.rows.length) throw new Error(`Not found name '${name}'`);
      return hex.encode(res.rows[0][0]);
    });
  }

  async setNip05(pubkey: Uint8Array, name: string) {
    await this.use(async (db) => {
      const res = await db.queryArray(
        "insert into nip05s (pubkey,name) values ($1,$2) on conflict do nothing returning name",
        [pubkey, name],
      );
      if (!res.rows.length) {
        throw new Error(
          "A pubkey can only has a nip-05 name or this name has been used",
        );
      }
    });
  }

  async delNip05(pubkey: Uint8Array, name: string) {
    await this.use(async (db) => {
      const res = await db.queryArray(
        "delete from nip05s where pubkey=$1 and name=$2 returning name",
        [pubkey, name],
      );
      if (!res.rows.length) {
        throw new Error(
          "You do not have name or this name do not belongs to you",
        );
      }
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

function makeQuery(params: ReqParams[]): [string, unknown[]] {
  const sqls: string[] = [], args: unknown[] = [];
  const _p = (p: unknown) => {
    args.push(p);
    return `$${args.length}`;
  };
  const makeSub = (p: ReqParams) => {
    const wheres: string[] = ["1=1"];
    if (p.ids) {
      const subWheres: string[] = [];
      const fullIds = p.ids.filter((i) => i.length === 64);
      const prefixIds = p.ids.filter((i) => i.length < 64);
      if (fullIds.length) {
        subWheres.push(`id=any(${_p(fullIds.map((i) => "\\x" + i))})`);
      }
      if (prefixIds.length) {
        for (const id of prefixIds) {
          subWheres.push(
            `id between ${_p("\\x" + id.padEnd(64, "0"))} and ${
              _p("\\x" + id.padEnd(64, "f"))
            }`,
          );
        }
      }
      if (subWheres.length > 1) {
        wheres.push("(" + subWheres.join(" or ") + ")");
      } else {
        wheres.push(subWheres[0]);
      }
    }

    if (p.authors) {
      const subWheres: string[] = [];
      const fullIds = p.authors.filter((i) => i.length === 64);
      const prefixIds = p.authors.filter((i) => i.length < 64);
      if (fullIds.length) {
        subWheres.push(`pubkey=any(${_p(fullIds.map((i) => "\\x" + i))})`);
        subWheres.push(
          `tags @> ${
            _p(JSON.stringify(fullIds.map((i) => ["delegation", i])))
          }`,
        );
      }
      if (prefixIds.length) {
        for (const id of prefixIds) {
          subWheres.push(
            `pubkey between ${_p("\\x" + id.padEnd(64, "0"))} and ${
              _p("\\x" + id.padEnd(64, "f"))
            }`,
          );
        }
      }
      if (subWheres.length > 1) {
        wheres.push("(" + subWheres.join(" or ") + ")");
      } else {
        wheres.push(subWheres[0]);
      }
    }

    if (p.kinds) {
      wheres.push(`kind=any(${_p(p.kinds)})`);
    }

    if (p.since) {
      wheres.push(`created_at > ${_p(new Date(p.since * 1000))}`);
    }

    if (p.until) {
      wheres.push(`created_at < ${_p(new Date(p.until * 1000))}`);
    }

    if (p.search) {
      wheres.push(`content like ${`%${p.search}%`}`);
    }

    // NIP-12
    for (const [k, v] of Object.entries(p)) {
      if (k[0] !== "#") continue;
      if (!(v instanceof Array)) continue;
      if (!(v as string[]).every((i) => typeof i === "string")) continue;

      const key = k.slice(1);
      wheres.push(`tags @> ${_p(JSON.stringify(v.map((i) => [key, i])))}`);
    }

    sqls.push(
      "select id,kind,created_at,content,pubkey,sig,tags from events where " +
        wheres.join(" and ") +
        " and (expires_at>current_timestamp or expires_at is null) and deleted_at is null",
    );
  };

  params.forEach((i) => makeSub(i));
  const maxLimit = Math.max(...params.map((i) => i.limit || 0));

  const query = sqls.join(" union ") +
    ` order by created_at ${maxLimit ? "desc" : "asc"} limit ${
      _p(maxLimit && maxLimit > 0 && maxLimit < 200 ? maxLimit : 200)
    }`;

  return [query, args];
}
