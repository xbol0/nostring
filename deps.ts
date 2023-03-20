export * as secp256k1 from "https://esm.sh/@noble/secp256k1@1.7.1";
import * as _hex from "https://deno.land/std@0.177.0/encoding/hex.ts";

export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

export const hex = {
  encode: (i: Uint8Array) => decoder.decode(_hex.encode(i)),
  decode: (i: string) => _hex.decode(encoder.encode(i)),
};
