/**
 * A java.util.HashMap's iteration order, for answers Java writes from one --
 * its put, resize and tree bins ported from the JDK the service runs on
 * (11). A key's bucket is String.hashCode, its high half folded in, masked
 * to the table size; the table starts at 16 and doubles past three quarters
 * full. A bucket keeps keys in the order they arrived until a ninth arrives:
 * then, under 64 buckets, the table doubles; at 64, the bucket becomes a
 * red-black tree ordered by hash then String.compareTo, whose root is moved
 * to the front and whose later keys are linked in after their parent -- so
 * eleven ids sharing a hash come out in Java's order, not arrival's. Checked
 * against the JDK's own HashMap (orthology.spec.mjs).
 */
/**
 * One key in a bucket. A bucket that becomes a tree gives its nodes the tree
 * fields, all set together (#treeifyBin), and a split back to a list clears
 * them.
 */
interface HashNode {
  hash: number;
  key: string;
  value: unknown;
  next: HashNode | null;
  tree?: boolean;
  prev?: HashNode | null;
  parent?: HashNode | null;
  left?: HashNode | null;
  right?: HashNode | null;
  red?: boolean;
}

export class JavaHashMap {
  #table: (HashNode | null)[] = new Array<HashNode | null>(16).fill(null);
  #keyHash: ((key: string) => number) | undefined;
  size = 0;

  /**
   * `hash` is the key's hashCode, String.hashCode unless given -- a
   * TargetResult's is Objects.hash(term), 31 more than its term's.
   */
  constructor({ hash }: { hash?: (key: string) => number } = {}) {
    this.#keyHash = hash;
  }

  #hashOf(key) {
    if (!this.#keyHash) return JavaHashMap.#hash(key);
    const h = this.#keyHash(key) | 0;
    return h ^ (h >>> 16);
  }

  /** String.hashCode, as an int. */
  static stringHash(key) {
    let h = 0;
    for (let at = 0; at < key.length; at += 1) h = (Math.imul(31, h) + key.charCodeAt(at)) | 0;
    return h;
  }

  static #hash(key) {
    let h = 0;
    for (let at = 0; at < key.length; at += 1) h = (Math.imul(31, h) + key.charCodeAt(at)) | 0;
    return h ^ (h >>> 16);
  }

  set(key, value) {
    const hash = this.#hashOf(key);
    const table = this.#table;
    const index = (table.length - 1) & hash;
    const p: HashNode | null = table[index] ?? null;
    let existing: HashNode | null = null;
    if (p === null) table[index] = { hash, key, value, next: null };
    else if (p.hash === hash && p.key === key) existing = p;
    else if (p.tree) existing = this.#putTreeValue(table, hash, key, value);
    else {
      let last: HashNode = p;
      for (let count = 0; ; count += 1) {
        const e = last.next;
        if (e === null) {
          last.next = { hash, key, value, next: null };
          if (count >= 7) this.#treeifyBin(hash);
          break;
        }
        if (e.hash === hash && e.key === key) {
          existing = e;
          break;
        }
        last = e;
      }
    }
    if (existing) {
      existing.value = value;
      return this;
    }
    this.size += 1;
    if (this.size > this.#table.length * 0.75) this.#resize();
    return this;
  }

  /**
   * HashSet.remove: the key unlinked from its bucket, the rest in order. A
   * tree bin -- eight keys sharing a bucket of 64 or more, which sets of
   * stable ids never come near -- is refused: Java rebalances it and moves
   * a new root to the front, which is not ported, and unlinking alone
   * would leave the tree to give wrong answers later.
   */
  delete(key) {
    const hash = this.#hashOf(key);
    const index = (this.#table.length - 1) & hash;
    if (this.#table[index]?.tree)
      throw new Error('JavaHashMap.delete from a tree bin is not ported');
    let previous: HashNode | null = null;
    for (let node = this.#table[index] ?? null; node; previous = node, node = node.next) {
      if (node.hash !== hash || node.key !== key) continue;
      if (previous) previous.next = node.next;
      else this.#table[index] = node.next;
      this.size -= 1;
      return true;
    }
    return false;
  }

  *entries() {
    for (let node of this.#table) for (; node; node = node.next) yield [node.key, node.value];
  }

  *keys() {
    for (const [key] of this.entries()) yield key;
  }

  #resize() {
    const old = this.#table;
    const table = new Array<HashNode | null>(old.length * 2).fill(null);
    this.#table = table;
    for (let index = 0; index < old.length; index += 1) {
      const head = old[index];
      if (!head) continue;
      if (head.next === null) table[head.hash & (table.length - 1)] = head;
      else if (head.tree) this.#split(table, head, index, old.length);
      else {
        const [lo, hi]: [HashNode[], HashNode[]] = [[], []];
        for (let node: HashNode | null = head; node; node = node.next)
          ((node.hash & old.length) === 0 ? lo : hi).push(node);
        const halves: [HashNode[], number][] = [
          [lo, index],
          [hi, index + old.length],
        ];
        for (const [list, at] of halves) {
          if (!list.length) continue;
          list.forEach((node, i) => (node.next = list[i + 1] ?? null));
          table[at] = list[0] ?? null;
        }
      }
    }
  }

  #treeifyBin(hash) {
    const table = this.#table;
    if (table.length < 64) return this.#resize();
    const index = (table.length - 1) & hash;
    let previous: HashNode | null = null;
    for (let node = table[index] ?? null; node; node = node.next) {
      Object.assign(node, {
        tree: true,
        prev: previous,
        parent: null,
        left: null,
        right: null,
        red: false,
      });
      previous = node;
    }
    this.#treeify(table, table[index]);
  }

  /** TreeNode.split: the bucket's nodes, in order, to the two halves of a doubled table. */
  #split(table, head, index, bit) {
    const [lo, hi]: [HashNode[], HashNode[]] = [[], []];
    for (let node: HashNode | null = head; node; node = node.next)
      ((node.hash & bit) === 0 ? lo : hi).push(node);
    const halves: [HashNode[], number, HashNode[]][] = [
      [lo, index, hi],
      [hi, index + bit, lo],
    ];
    for (const [list, at, other] of halves) {
      if (!list.length) continue;
      list.forEach((node, i) => {
        node.next = list[i + 1] ?? null;
        node.prev = list[i - 1] ?? null;
      });
      if (list.length <= 6) {
        for (const node of list) {
          node.tree = false;
          node.parent = node.left = node.right = node.prev = null;
        }
        table[at] = list[0];
      } else {
        table[at] = list[0];
        if (other.length) this.#treeify(table, list[0]);
      }
    }
  }

  static #direction(hash, key, node) {
    if (node.hash > hash) return -1;
    if (node.hash < hash) return 1;
    return key < node.key ? -1 : key > node.key ? 1 : 0;
  }

  #treeify(table, head) {
    let root: HashNode | null = null;
    for (let x: HashNode | null = head, next: HashNode | null; x; x = next) {
      next = x.next;
      x.left = x.right = null;
      if (root === null) {
        x.parent = null;
        x.red = false;
        root = x;
        continue;
      }
      for (let p: HashNode = root; ;) {
        const dir = JavaHashMap.#direction(x.hash, x.key, p);
        const xp = p;
        // A tree node's children are set, to null at least, when it joins.
        const child = (dir <= 0 ? p.left : p.right) ?? null;
        if (child === null) {
          x.parent = xp;
          if (dir <= 0) xp.left = x;
          else xp.right = x;
          root = JavaHashMap.#balanceInsertion(root, x);
          break;
        }
        p = child;
      }
    }
    JavaHashMap.#moveRootToFront(table, root);
  }

  #putTreeValue(table, hash, key, value) {
    const root = table[(table.length - 1) & hash];
    for (let p = root; ;) {
      if (p.hash === hash && p.key === key) return p;
      const dir = JavaHashMap.#direction(hash, key, p);
      const xp = p;
      p = dir <= 0 ? p.left : p.right;
      if (p === null) {
        const xpn = xp.next;
        const x = {
          hash,
          key,
          value,
          next: xpn,
          tree: true,
          prev: xp,
          parent: xp,
          left: null,
          right: null,
          red: false,
        };
        if (dir <= 0) xp.left = x;
        else xp.right = x;
        xp.next = x;
        if (xpn) xpn.prev = x;
        JavaHashMap.#moveRootToFront(table, JavaHashMap.#balanceInsertion(root, x));
        return null;
      }
    }
  }

  static #moveRootToFront(table, root) {
    const index = (table.length - 1) & root.hash;
    const first = table[index];
    if (root === first) return;
    table[index] = root;
    const { prev: rp, next: rn } = root;
    if (rn) rn.prev = rp;
    if (rp) rp.next = rn;
    if (first) first.prev = root;
    root.next = first;
    root.prev = null;
  }

  static #rotateLeft(root, p) {
    const r = p.right;
    if (!r) return root;
    const rl = (p.right = r.left);
    if (rl) rl.parent = p;
    const pp = (r.parent = p.parent);
    if (!pp) (root = r).red = false;
    else if (pp.left === p) pp.left = r;
    else pp.right = r;
    r.left = p;
    p.parent = r;
    return root;
  }

  static #rotateRight(root, p) {
    const l = p.left;
    if (!l) return root;
    const lr = (p.left = l.right);
    if (lr) lr.parent = p;
    const pp = (l.parent = p.parent);
    if (!pp) (root = l).red = false;
    else if (pp.right === p) pp.right = l;
    else pp.left = l;
    l.right = p;
    p.parent = l;
    return root;
  }

  static #balanceInsertion(root, x) {
    x.red = true;
    for (;;) {
      const xp = x.parent;
      if (!xp) {
        x.red = false;
        return x;
      }
      const xpp = xp.parent;
      if (!xp.red || !xpp) return root;
      const xppl = xpp.left;
      const xppr = xpp.right;
      const uncle = xp === xppl ? xppr : xppl;
      if (uncle?.red) {
        uncle.red = false;
        xp.red = false;
        xpp.red = true;
        x = xpp;
        continue;
      }
      // x's parent is red and its uncle black: rotate x up to where its parent
      // was if it is the inner grandchild, then rotate the grandparent.
      const left = xp === xppl;
      let parent = xp;
      if (x === (left ? xp.right : xp.left)) {
        x = xp;
        root = left ? JavaHashMap.#rotateLeft(root, x) : JavaHashMap.#rotateRight(root, x);
        parent = x.parent;
      }
      const grand = parent ? parent.parent : null;
      if (parent) {
        parent.red = false;
        if (grand) {
          grand.red = true;
          root = left
            ? JavaHashMap.#rotateRight(root, grand)
            : JavaHashMap.#rotateLeft(root, grand);
        }
      }
    }
  }
}
