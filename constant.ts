import type { parseEventRetention } from "./util.ts";

// Default supported NIPs
// Currently not suppported NIP-50
export const DefaultNIPs = "1,9,11,12,13,15,16,20,22,26,33,40,42,45";

export const CORSHeaders = { "Access-Control-Allow-Origin": "*" };

// From 1 day ago to 5 minutes from now
export const DefaultTimeRange = "-86400~300";

export const DefaultBotAvatar =
  "https://media-uploader.orzv.workers.dev/pomf2.lain.la/f/m4lnneh4.png";

export const FilterItemLimit = 100;

// Events in spam filter
export const SpamEventKinds = new Set([1, 4, 42, 30023]);

export const SpamDetectPercent = "0.5";

export const DefaultPoolSize = 3;

type ERs = ReturnType<typeof parseEventRetention>;
export const DefaultEventRetension: ERs = [
  // Note and DM events store 1 year or up to 5000
  { kinds: [1, 4], time: 31536000, count: 5000 },

  // Reactions and reposts store up to 10000
  { kinds: [6, 7], count: 10000 },

  // User meta infos store forever
  { kinds: [0, 2, 3], count: 1 },

  // Other events up to 1000
  { count: 1000 },
];

export const BotAboutTemplate = `This is a Bot of %NAME%, relay URL is %URL%.`;

export const HomeTemplate =
  `This is a Nostr relay powered by Nostring (https://github.com/xbol0/nostring)

Name: %name

Description: %desc

Admin: %admin

You can join by add to your relay list: %url

You can get some helps or payment info via this bot (type /help): %bot`;
