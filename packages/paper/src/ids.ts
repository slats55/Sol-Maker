/**
 * Deterministic id generation.
 *
 * The engine must be reproducible: identical input → byte-identical output. So
 * ids come from a seeded monotonic counter, never `Math.random()` or a clock.
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
