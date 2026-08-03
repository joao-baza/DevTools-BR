export interface RandomSource {
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function assertIntegerBounds(min: number, max: number): void {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isInteger(min) || !Number.isInteger(max) || min > max) {
    throw new RangeError("invalid random integer bounds");
  }
}

export function createRandom(seed?: string): RandomSource {
  let state = seed == null ? Math.floor(Math.random() * 0xffffffff) : hashSeed(seed);

  const next = () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 0x100000000;
  };

  return {
    int(min: number, max: number) {
      assertIntegerBounds(min, max);
      return Math.floor(next() * (max - min + 1)) + min;
    },
    pick<T>(items: readonly T[]) {
      if (items.length === 0) {
        throw new Error("cannot pick from an empty array");
      }
      return items[this.int(0, items.length - 1)];
    }
  };
}
