export interface DataAdapter {
  insertEvent(e: NostrEvent): Promise<void>;
  query(params: ReqParams[]): Promise<NostrEvent[]>;
  delete(ids: string[], author: string): Promise<void>;
  replaceEvent(e: NostrEvent): Promise<void>;
}

export type ReqParams = Partial<
  {
    ids: string[];
    authors: string[];
    kinds: number[];
    since: number;
    until: number;
    limit: number;
    search: string;
  } & Record<string, string[]>
>;

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
};

export type RawEvent = NostrEvent & {
  id: Uint8Array;
  pubkey: Uint8Array;
  sig: Uint8Array;
  created_at: Date;
};

export type Nip11 = {
  "name": string;
  "description": string;
  "pubkey": string;
  "contact": string;
  "supported_nips": number[];
  "software": string;
  "version": string;
};

export type ApplicationInit = {
  db: DataAdapter;
  name?: string;
  description?: string;
  pubkey?: string;
  contact?: string;
  minPow?: number;
  nip11?: Partial<Nip11>;
  upgradeWebSocketFn: (
    req: Request,
  ) => { socket: WebSocket; response: Response };
  onEstablished?: (ws: WebSocket) => unknown;
  onConnect?: (ws: WebSocket, req: Request) => unknown;
  onEvent?: (e: NostrEvent, ws: WebSocket) => unknown;
  onAuth?: (e: NostrEvent, ws: WebSocket) => unknown;
  onReq?: (id: string, filters: ReqParams[], ws: WebSocket) => unknown;
  onStream?: (e: NostrEvent, id: string, ws: WebSocket) => boolean;
};
