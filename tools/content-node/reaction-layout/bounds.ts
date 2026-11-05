/**
 * reaction-exporter's Bounds: a box that keeps its centre and far corner as
 * fields, updated by each setter as Java's does -- so a value is computed in
 * the same steps, and its last bit agrees with Java's.
 */
export class Bounds {
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  cx = 0;
  cy = 0;
  mx = 0;
  my = 0;

  static of(x: number, y: number, width: number, height: number): Bounds {
    const bounds = new Bounds();
    Object.assign(bounds, {
      x,
      y,
      width,
      height,
      cx: x + 0.5 * width,
      cy: y + 0.5 * height,
      mx: x + width,
      my: y + height,
    });
    return bounds;
  }

  /** The copy constructor: every field as it is. */
  copy(): Bounds {
    return Object.assign(new Bounds(), this);
  }

  setX(x: number) {
    this.x = x;
    this.mx = x + this.width;
    this.cx = x + 0.5 * this.width;
  }

  setY(y: number) {
    this.y = y;
    this.my = y + this.height;
    this.cy = y + 0.5 * this.height;
  }

  setWidth(width: number) {
    this.width = width;
    this.mx = this.x + width;
    this.cx = this.x + 0.5 * width;
  }

  setHeight(height: number) {
    this.height = height;
    this.my = this.y + height;
    this.cy = this.y + 0.5 * height;
  }

  setCenter(x: number, y: number) {
    this.x = x - 0.5 * this.width;
    this.y = y - 0.5 * this.height;
    this.cx = x;
    this.cy = y;
    this.mx = this.x + this.width;
    this.my = this.y + this.height;
  }

  move(dx: number, dy: number) {
    this.setX(this.x + dx);
    this.setY(this.y + dy);
  }

  union(that: Bounds | undefined) {
    if (!that) return;
    const minX = Math.min(this.x, that.x);
    const minY = Math.min(this.y, that.y);
    const maxX = Math.max(this.mx, that.mx);
    const maxY = Math.max(this.my, that.my);
    this.setX(minX);
    this.setY(minY);
    this.setWidth(maxX - minX);
    this.setHeight(maxY - minY);
  }

  set(bounds: Bounds) {
    this.x = bounds.x;
    this.y = bounds.y;
    this.setWidth(bounds.width);
    this.setHeight(bounds.height);
  }

  intersects(that: Bounds): boolean {
    const overlap = (r0: number, r1: number, s0: number, s1: number) =>
      (r0 < s0 && s0 < r1) || (s0 < r0 && r0 < s1);
    return overlap(this.x, this.mx, that.x, that.mx) && overlap(this.y, this.my, that.y, that.my);
  }
}
