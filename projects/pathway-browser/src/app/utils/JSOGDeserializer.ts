/**?
 *  JavaScript Object Graph
 *  [
 *  {
 *    "@id": "1",
 *    "name": "Sally",
 *    "secretSanta": {
 *      "@id": "2",
 *      "name": "Bob",
 *      "secretSanta": {
 *        "@id": "3",
 *        "name": "Fred",
 *        "secretSanta": { "@ref": "1" }
 *      }
 *    }
 *  },
 *  { "@ref": "2" },
 *  { "@ref": "3" }
 * ]
 * @id values are arbitrary strings.
 * @id definitions must come before @ref references.
 *
 * This class is to help deserialize JSOG object to Event.
 * Track the @id of every object deserialized. When a @ref is encountered, replace it with the object referenced.
 *
 */

import type { JsogReference } from '../../../../contract/graph.ts';

/**
 * A JSOG answer once JSOGDeserializer has resolved it: every reference
 * replaced by the object it refers to (spec 016, research R9). The contract
 * describes the answer as written, `X<JsogReference>`; the pathway browser
 * reads `Resolved<X<JsogReference>>`.
 */
export type Resolved<T> = T extends JsogReference
  ? never
  : T extends (infer E)[]
    ? Resolved<E>[]
    : T extends object
      ? { [K in keyof T]: Resolved<T[K]> }
      : T;

/**
 * A resolved object as JSOG writes it, for a reader whose own type is the
 * resolved one: each related object may be a reference to one written
 * earlier. A reader asks for `JsogObject<T>` and JSOGDeserializer gives back
 * the `T`. The `@id` an object is written with is the contract's
 * (`DatabaseObjectFields`), or falls under the index signature the readers'
 * own graph types still have.
 */
export type JsogObject<T> = { [K in keyof T]: Jsog<T[K]> };

/**
 * A value of a resolved object as JSOG writes it: an object may be a
 * reference. A value typed `any` (the readers' `[key: string]: any`, until
 * each class moves into the contract) stays `any`: a conditional type takes
 * both branches over `any`, which would make it `{}`.
 */
type Jsog<T> = 0 extends 1 & T
  ? T
  : T extends (infer E)[]
    ? Jsog<E>[]
    : T extends object
      ? JsogObject<T> | JsogReference
      : T;

/** Anything JSON can hold an object or an array in: what the walk below reads and writes. */
type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null;

export class JSOGDeserializer {
  private objectMap: Record<string, Node> = {};

  /**
   * The answer with every reference replaced by the object it names, in
   * place. Its type is the reader's resolved one: that every reference is
   * resolved is what the walk below does, and no type can follow it there.
   */
  public deserialize<T>(jsog: JsogObject<T>): T {
    const root: unknown = jsog;
    if (!isNode(root)) {
      // As the walk always did: no answer at all fails on reading its `@id`,
      // and any other value that is not an object comes back as it is.
      if (root === null || root === undefined)
        throw new TypeError(`Cannot read properties of ${String(root)} (reading '@id')`);
      return jsog as T;
    }
    // Build @id and object map
    this.buildIdToObjectMap(root);
    // Resolve all @ref
    return this.resolveReferences(root) as T;
  }

  private buildIdToObjectMap(jsogObject: Node) {
    const id = jsogObject['@id'];
    if (id) {
      this.objectMap[String(id)] = jsogObject;
    }

    for (const key in jsogObject) {
      const value = jsogObject[key];
      if (isNode(value)) {
        this.buildIdToObjectMap(value);
      }
    }
  }

  private resolveReferences(obj: Node): Node {
    const ref = obj['@ref'];
    if (ref) {
      // A reference always points back at an object already read; one that
      // does not is left as it is rather than becoming undefined.
      return this.objectMap[String(ref)] ?? obj;
    }

    for (const key in obj) {
      const value = obj[key];
      if (isNode(value)) {
        obj[key] = this.resolveReferences(value);
      }
    }
    return obj;
  }
}
