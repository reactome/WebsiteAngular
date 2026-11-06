/**
 * JSON compared as the reaction layout's comparison declares it (research
 * D21): numbers within a billionth of their size, everything else exactly.
 * Java's sin and cos are HotSpot's x86 routines, whose last bit differs from
 * Node's on some diagonal connectors and regulator fans; Java's own bits
 * would change on another platform, so they are not a stable target.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function sameWithin(java: Json, node: Json): boolean {
  if (typeof java === 'number' && typeof node === 'number')
    return java === node || Math.abs(java - node) <= 1e-9 * Math.max(1, Math.abs(java));
  if (Array.isArray(java) && Array.isArray(node))
    return (
      java.length === node.length && java.every((value, at) => sameWithin(value, node[at] as Json))
    );
  if (
    java &&
    node &&
    typeof java === 'object' &&
    typeof node === 'object' &&
    !Array.isArray(java) &&
    !Array.isArray(node)
  ) {
    const keys = [...new Set([...Object.keys(java), ...Object.keys(node)])];
    return keys.every(
      (key) => key in java && key in node && sameWithin(java[key] as Json, node[key] as Json)
    );
  }
  return java === node;
}
