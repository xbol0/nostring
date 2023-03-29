import { z } from "./deps.ts";

const ER = z.object({
  time: z.number().optional(),
  count: z.number().optional(),
  kinds: z.number().or(z.number().array().length(2)).array().optional(),
}).array();

const Fee = z.object({
  amount: z.number().min(0),
  period: z.number().optional(),
  kinds: z.number().array().optional(),
});

export type FeeType = z.infer<typeof Fee>;

export function parseEventRetention(input: string) {
  return ER.parse(JSON.parse(input));
}

export function makeCollection(arr: (number | number[])[]) {
  const list = new Set<number>();
  for (const i of arr) {
    if (typeof i === "number") {
      list.add(i);
    } else {
      getRangeNumbers(i).forEach((j) => list.add(j));
    }
  }
  return [...list];
}

function getRangeNumbers(arr: number[]): number[] {
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const range = Array.from({ length: max - min + 1 }, (_, i) => i + min);
  return range;
}

export function parseFeeConfigure(str: string): FeeType[] {
  const arr = str.split(";");
  const list: FeeType[] = [];

  const gp = (s: string) => {
    const a = s.split("/");

    if (a.length === 1) {
      return { amount: parseInt(a[0]) };
    } else if (a.length === 2) {
      return { amount: parseInt(a[0]), period: parseInt(a[1]) };
    } else {
      throw new Error("Invalid format: amount");
    }
  };

  for (const item of arr) {
    const at1 = item.split(":");
    if (at1.length === 1) {
      // No kinds definition
      list.push(gp(at1[0]));
    } else {
      const kinds = at1[0].split(",").map((i) => parseInt(i));
      list.push({ ...gp(at1[1]), kinds: [...new Set(kinds)] });
    }
  }

  return list;
}

// Generate by ChatGPT 🥰
export function formatSeconds(seconds: number): string {
  const year = Math.floor(seconds / 31536000);
  const month = Math.floor((seconds % 31536000) / 2592000);
  const day = Math.floor(((seconds % 31536000) % 2592000) / 86400);
  const hour = Math.floor((((seconds % 31536000) % 2592000) % 86400) / 3600);
  const minute = Math.floor(
    ((((seconds % 31536000) % 2592000) % 86400) % 3600) / 60,
  );
  const second = ((((seconds % 31536000) % 2592000) % 86400) % 3600) % 60;

  let result = "";
  if (year > 0) {
    result = `${year} year${year > 1 ? "s" : ""}`;
  }
  if (month > 0) {
    result += ` ${month} month${month > 1 ? "s" : ""}`;
  }
  if (day > 0) {
    result += ` ${day} day${day > 1 ? "s" : ""}`;
  }
  if (hour > 0) {
    result += ` ${hour} hour${hour > 1 ? "s" : ""}`;
  }
  if (minute > 0) {
    result += ` ${minute} minute${minute > 1 ? "s" : ""}`;
  }
  if (second > 0) {
    result += ` ${second} second${second > 1 ? "s" : ""}`;
  }
  return result.trim();
}
