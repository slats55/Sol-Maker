/**
 * Deterministic id generation for strategy reports.
 *
 * The engine must be reproducible: identical input → byte-identical output. So
 * ids come from a seeded monotonic counter, never `Math.random()` or a clock.
 * Mirrors `@soulmaker/paper`'s `makeIdGen` so the two engines share one pattern
 * without coupling on each other's value exports.
 */

export interface IdGen {
  (): string;
}

/** A monotonic id generator: `${prefix}-1`, `${prefix}-2`, … */
export function makeIdGen(prefix: string): IdGen {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}
