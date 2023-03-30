import type { nostr } from "./deps.ts";

export interface Repository {
  init(): Promise<void>;
  save(e: nostr.Event): Promise<void>;
  query(filters: nostr.Filter): Promise<nostr.Event[]>;
  processPayment(e: nostr.Event): Promise<void>;
}

export type Nip11 = {
  name: string;
  description: string;
  pubkey: string;
  contact: string;
  supported_nips: number[];
  software: string;
  version: string;
};

export type Limits = {
  maxMessageLength: number;
  maxSubscriptions: number;
  maxFilters: number;
  maxLimit: number;
  maxSubidLength: number;
  minPrefix: number;
  maxEventTags: number;
  maxContentLength: number;
  minPowDifficulty: number;
  authRequired: boolean;
  paymentRequired: boolean;
};

export type EventRetention = {
  kinds?: (number | number[])[];
  count?: number;
  time?: number;
};

export type User = {
  pubkey: string;
  balance: bigint;
  admitted_at: Date | null;
};
