/**
 * The render cache's size, kept as a running total (spec 018 T020).
 *
 * The cache used to be measured after every write by listing its folder and
 * reading each file's size. That costs a stat per cached figure: about 2.7 s per
 * write at the 19,000 figures of a release's book, four writes at a time, on the
 * event loop that also answers the render page's requests. Figures slowed
 * through every run of the book, held pages or fresh (T010).
 *
 * Here the folder is read once, when the total is first needed, and again every
 * `rescanEvery` writes, so a cache folder shared with another process or changed
 * under the service does not drift for long; between those, each write adds its
 * size less that of the file it replaced. An eviction, which reads the folder
 * anyway, sets the total it leaves.
 */
export class CacheTotal {
  private total: number | null = null;
  private writes = 0;
  private readonly scan: () => Promise<number>;
  private readonly rescanEvery: number;

  constructor(scan: () => Promise<number>, rescanEvery = 1000) {
    this.scan = scan;
    this.rescanEvery = rescanEvery;
  }

  /** The total after a write of `added` bytes over a file of `replaced` bytes (0 for a new file). */
  async afterWrite(added: number, replaced: number): Promise<number> {
    this.writes++;
    if (this.total === null || this.writes % this.rescanEvery === 0) {
      this.total = await this.scan();
    } else {
      this.total += added - replaced;
    }
    return this.total;
  }

  /** The total an eviction left. */
  set(total: number): void {
    this.total = total;
  }
}
