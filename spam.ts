import { SpamEventKinds } from "./constant.ts";
import { nostr } from "./deps.ts";

export class SpamFilter {
  words: Set<string[]> = new Set();
  percent = 0.5;
  timer = 0;

  constructor(percent: number) {
    this.percent = percent;
  }

  async start() {
    await this.update();
    this.timer = setInterval(() => this.update(), 60000);
  }

  async update() {
    try {
      const all = await Promise.all([this.xbol0Words(), this.nostrBandWords()]);
      this.words.clear();
      for (const i of all.flat()) {
        this.words.add(i);
      }
      console.info(new Date(), "update words", this.words.size);
    } catch {
      //
    }
  }

  filter(e: nostr.Event) {
    if (!SpamEventKinds.has(e.kind)) return true;
    for (const words of this.words) {
      let count = 0;

      for (const w of words) {
        if (e.content.includes(w)) count++;

        if (count / words.length >= this.percent) return false;
      }
    }

    return true;
  }

  async nostrBandWords() {
    try {
      const res = await fetch(
        "https://spam.nostr.band/spam_api?method=get_current_spam",
      );
      if (res.status !== 200) return [];
      const json = await res.json();
      return json.cluster_words.map((i: { words: string[] }) => i.words);
    } catch {
      return [];
    }
  }

  async xbol0Words() {
    try {
      const res = await fetch(
        "https://raw.githubusercontent.com/xbol0/nostr-spam-words/main/words.txt",
      );
      const list = (await res.text()).split("\n").filter((i) => !!i);
      return list.map((i) => i.split(" ")).filter((i) => i.length > 1);
    } catch {
      return [];
    }
  }

  stop() {
    clearInterval(this.timer);
  }
}
