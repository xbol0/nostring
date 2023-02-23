type NostrBandSpamWords = {
  cluster_words: { words: string[] }[];
};

export class SpamFilter {
  list = new Set<string[]>();

  async getNostrBand() {
    const res = await fetch(
      "https://spam.nostr.band/spam_api?method=get_current_spam",
    );
    if (res.status !== 200) {
      await res.body?.cancel();
      return [];
    }
    const json = await res.json() as NostrBandSpamWords;
    return json.cluster_words.map((i) => i.words);
  }

  async updateWordList() {
    try {
      const arr = await Promise.all([this.getNostrBand()]);
      this.list.clear();
      for (const item of arr.flat()) {
        this.list.add(item);
      }
      console.log(`update ${this.list.size} word list`);
    } catch (err) {
      console.error(err);
    }
  }

  isSpam(str: string) {
    if (this.list.size === 0) return false;

    for (const item of this.list) {
      let count = 0;
      for (const w of item) {
        if (str.includes(w)) {
          count++;
          if (count >= Math.floor(item.length / 2)) {
            return true;
          }
        }
      }
    }

    return false;
  }
}
