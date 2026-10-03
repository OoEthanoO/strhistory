/** Small least-recently-used cache on top of Map's insertion order. */
export class Lru<K, V> {
  private readonly map = new Map<K, V>();

  /** `capacity` 0 keeps nothing. */
  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new RangeError(`@alexs-atlas/borders: cache size must be a non-negative integer, got ${String(capacity)}`);
    }
  }

  get size(): number {
    return this.map.size;
  }

  /** Returns the value and marks it most recently used. */
  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  clear(): void {
    this.map.clear();
  }
}
