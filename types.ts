export interface DataAdapter {
  init(): Promise<void>;
  insertEvent(e: NostrEvent): Promise<void>;
  query(params: ReqParams & { skip?: number }): Promise<NostrEvent[]>;
  delete(ids: string[], author: string): Promise<void>;
  replaceEvent(e: NostrEvent): Promise<void>;
}

export type ReqParams =
  & Record<string, unknown>
  & Partial<{
    ids: string[];
    authors: string[];
    kinds: number[];
    "#e": string[];
    "#p": string[];
    since: number;
    until: number;
    limit: number;

    // NIP-50
    search: string;
  }>;

export type Subinfo = {
  sendCount: number;
  socket: WebSocket;
  filters: ReqParams[];
};

export type ClientEventMessage = ["EVENT", NostrEvent];
export type ClientReqMessage = ["REQ", string, ...ReqParams[]];
export type ClientCloseMessage = ["CLOSE", string];
export type ClientAuthMessage = ["AUTH", NostrEvent];

export type ClientMessage =
  | ClientEventMessage
  | ClientReqMessage
  | ClientCloseMessage
  | ClientAuthMessage;

export type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
  expires_at?: number | null;
  delegator?: string | null;
};

export type RawEvent = NostrEvent & {
  id: Uint8Array;
  pubkey: Uint8Array;
  sig: Uint8Array;
  created_at: Date;
};
