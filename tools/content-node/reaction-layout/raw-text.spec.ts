// @vitest-environment node
//
// The reaction layout's answer compared as text (research D21, D22): Java's
// bytes, but for the declared differences -- the top keys' order, the
// event's two getter-only fields' order, and numbers within a billionth
// written as Java writes them.
import { describe, expect, it } from 'vitest';
import { rawDifference, tokens, topMembers } from './raw-text.ts';

const JAVA =
  '{"diagram":{"nodes":[{"id":5,"position":{"x":288.6301451057273,"y":66.0}}],"minX":0},' +
  '"graph":{"edges":[{"dbId":9,"entityFunctionalStatus":[3],"speciesID":0}]}}';

describe('rawDifference', () => {
  it('finds none in the same text', () => {
    expect(rawDifference(JAVA, JAVA)).toBeUndefined();
  });

  it('takes the top keys in either order (Map.of)', () => {
    const [[, diagram], [, graph]] = topMembers(JAVA) as [[string, string], [string, string]];
    expect(rawDifference(`{"graph":${graph},"diagram":${diagram}}`, JAVA)).toBeUndefined();
  });

  it("takes the event's speciesID and entityFunctionalStatus in either order", () => {
    const swapped = JAVA.replace(
      '"entityFunctionalStatus":[3],"speciesID":0',
      '"speciesID":0,"entityFunctionalStatus":[3]'
    );
    expect(rawDifference(swapped, JAVA)).toBeUndefined();
    // But only those two: node's side is not reordered.
    expect(rawDifference(JAVA, swapped)).toBeDefined();
  });

  it("takes a last-bit difference written as Java's double", () => {
    expect(
      rawDifference(JAVA, JAVA.replace('288.6301451057273', '288.63014510572737'))
    ).toBeUndefined();
  });

  it('finds a number written another way, even of the same value', () => {
    expect(rawDifference(JAVA, JAVA.replace('66.0', '66'))).toBe(
      '.diagram.nodes[0].position.y (java 66.0, node 66)'
    );
    expect(rawDifference(JAVA, JAVA.replace('"minX":0', '"minX":0.0'))).toBe(
      '.diagram.minX (java 0, node 0.0)'
    );
    const small = '{"diagram":{"x":1.0E-4}}';
    expect(rawDifference(small, '{"diagram":{"x":0.0001}}')).toBeDefined();
    expect(rawDifference('{"diagram":{"x":-0.0}}', '{"diagram":{"x":0.0}}')).toBeDefined();
  });

  it('finds a number further apart than a billionth', () => {
    expect(rawDifference(JAVA, JAVA.replace('288.6301451057273', '288.6301461057273'))).toBe(
      '.diagram.nodes[0].position.x (java 288.6301451057273, node 288.6301461057273)'
    );
  });

  it('finds whitespace, key order and a field left out or added', () => {
    expect(rawDifference(JAVA, JAVA.replace('"minX":0', '"minX": 0'))).toBeDefined();
    expect(
      rawDifference(
        JAVA,
        JAVA.replace('{"x":288.6301451057273,"y":66.0}', '{"y":66.0,"x":288.6301451057273}')
      )
    ).toBe('.diagram.nodes[0].position.x: text differs at character 41');
    expect(rawDifference(JAVA, JAVA.replace(',"minX":0', ''))).toBeDefined();
    expect(rawDifference(JAVA, JAVA.replace('"minX":0', '"minX":0,"maxX":1'))).toBeDefined();
    expect(rawDifference(JAVA, `${JAVA} `)).toBe(".: java's text ends first");
  });

  it('says where, never what: no string of the answer in its report', () => {
    const named = '{"diagram":{"displayName":"one name"}}';
    expect(rawDifference(named, '{"diagram":{"displayName":"another"}}')).toBe(
      '.diagram.displayName: text differs at character 26'
    );
  });
});

describe('tokens', () => {
  it('keeps a string whole, escaped quotes and all', () => {
    expect(tokens('["a\\"b",1]').map((t) => t.text)).toEqual(['[', '"a\\"b"', ',', '1', ']']);
  });
});
