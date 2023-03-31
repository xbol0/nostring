import { hex, pg } from "../deps.ts";

type EventItem = {
  id: Uint8Array;
  pubkey: Uint8Array;
  kind: bigint;
  content: string;
  created_at: Date;
  tags: string[][];
  sig: Uint8Array;
};

run(Deno.args[0], Deno.args[1]);

async function run(url1: string, url2: string) {
  const origin = new pg.Client(url1);
  const target = new pg.Client(url2);

  await origin.connect();
  console.log("Connect origin server success");

  await target.connect();
  console.log("Connect target server success");

  let total = 0, inserted = 0, skip = 0;
  const r = await origin.queryArray("select count(*) from events");
  total = Number(r.rows[0][0]);
  console.log("Total: ", total);

  const tx = origin.createTransaction("migration");
  await tx.begin();

  await tx.queryArray("declare ec cursor for select * from events");

  while (true) {
    const res = await tx.queryObject<EventItem>("fetch forward 100 from ec");
    if (res.rows.length === 0) break;

    const ids = res.rows.map((i) => hex.encode(i.id));
    const res2 = await target.queryArray(
      "select id from events where id=any($1)",
      [ids],
    );
    skip += res2.rows.length;

    const exists = res2.rows.flat();
    const list = res.rows.filter((i) => !exists.includes(i.id));

    let sql =
      "insert into events (id,pubkey,kind,content,created_at,tags,sig,delegator,expired_at,dtag) values ";
    let i = 1;
    const args: unknown[] = [], queries: string[] = [];

    for (const e of list) {
      const delegator = e.tags.find((i) => i[0] === "delegation")?.[1] ||
        null;
      const expired_at = e.tags.find((i) => i[0] === "expiration")?.[1] ||
        null;
      const dtag = e.tags.find((i) => i[0] === "d")?.[1] || "";
      queries.push(
        `($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`,
      );
      args.push(
        hex.encode(e.id),
        hex.encode(e.pubkey),
        e.kind,
        e.content,
        e.created_at,
        JSON.stringify(e.tags),
        hex.encode(e.sig),
        delegator,
        expired_at ? new Date(parseInt(expired_at) * 1000) : null,
        dtag,
      );
    }

    if (!queries.length) continue;
    sql += queries.join(",") +
      " on conflict do nothing returning id";

    const res3 = await target.queryArray(sql, args);
    inserted += Number(res3.rows.length);

    console.log(`${inserted}/${skip}`);
  }

  await tx.queryArray("close ec");
  await tx.commit();

  console.log("Migration finished.");
  console.log(`Total: ${total} Inserted: ${inserted} Skip: ${skip}`);
}
