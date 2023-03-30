import * as _hex from "https://deno.land/std@0.177.0/encoding/hex.ts";
export * as nostr from "https://esm.sh/nostr-tools@1.7.5";
export * as pg from "https://deno.land/x/postgres@v0.17.0/mod.ts";
export * as http from "https://deno.land/std@0.181.0/http/mod.ts";
export { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
export * as lnurl from "https://esm.sh/js-lnurl@0.5.1";
export * as bolt from "https://esm.sh/bolt11@1.4.1";

export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

export const hex = {
  encode: (i: Uint8Array) => decoder.decode(_hex.encode(i)),
  decode: (i: string) => _hex.decode(encoder.encode(i)),
};
