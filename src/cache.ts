const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map<string, { v: string[]; c: number; p: number; t: number }>();

export function cget(k: string) {
  const x = cache.get(k);
  if (x && Date.now() - x.t < CACHE_TTL) return x;
  return null;
}

export function cset(k: string, v: string[], c: number, p: number): void {
  cache.set(k, { v, c, p, t: Date.now() });
}
