import type { nostr } from "./deps.ts";

export interface Repository {
  init(): Promise<void>;
  save(e: nostr.Event): Promise<void>;
  query(filters: nostr.Filter): Promise<nostr.Event[]>;
  createInvoice(invoice: Invoice): Promise<void>;
  getInvoice(id: string): Promise<Invoice>;
  resolveInvoice(id: string): Promise<void>;
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

export type Invoice = {
  id: string;
  pubkey: string;
  bolt11: string;
  amount: number;
  description: string;
  paid_at: Date | null;
  expired_at: Date;
};

export interface PaymentProvider {
  createInvoice(
    amount: number,
    pubkey: string,
    memo?: string,
  ): Promise<Invoice>;
  getInvoice(id: string): Promise<Invoice>;
  resolveCallback(req: Request): Promise<void>;
}
