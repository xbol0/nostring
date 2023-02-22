type NostrBandSpamWords = {
  cluster_words: { words: string[] }[];
};

const Wordlist = new Set<string[]>();

async function getNostrBand() {
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

export async function updateWordList() {
  try {
    const arr = await Promise.all([getNostrBand()]);
    Wordlist.clear();
    for (const item of arr.flat()) {
      Wordlist.add(item);
    }
    console.log(`update ${Wordlist.size} word list`);
  } catch (err) {
    console.error(err);
  }
}

export function isSpam(str: string) {
  if (Wordlist.size === 0) return false;

  for (const item of Wordlist) {
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
