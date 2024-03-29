import type { nostr } from "./deps.ts";

export interface Repository {
  init(): Promise<void>;
  save(e: nostr.Event): Promise<void>;
  query(filters: nostr.Filter): Promise<nostr.Event[]>;
  count(filters: nostr.Filter): Promise<number>;
  processPayment(e: nostr.Event): Promise<void>;
  status(): Promise<Record<string, number>>;
  pubkeyInfo(pubkey: string): Promise<User>;
}

export type Nip11 = {
  name: string;
  description: string;
  pubkey: string;
  contact: string;
  supported_nips: number[];
  software: string;
  version: string;
} & Record<string, unknown>;

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
