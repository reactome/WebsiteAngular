// @vitest-environment node
//
// The reaction layout's answer as Java writes it (research D22, step 4).
// EXPECTED is Jackson's text but for one hand edit: the same objects built
// from the deployed diagram-reader 1.2.5's classes, field by field, and
// written by the deployed Jackson 2.13 with ContentService's mapper
// (NON_EMPTY, the Flatten view) under JDK 11, into a LinkedHashMap with
// "diagram" first. The event's last two keys, `entityFunctionalStatus` and
// `speciesID`, were then put by hand in the deployed service's order: their
// order follows what the JVM loaded first, and the writing program's was the
// other (D22). It holds each rule: every class's field order, what is
// left out (null, "" and empty lists; not 0 or false), and number text
// (Doubles as Double.toString: 66.0, -0.0, 1.0E-4, 1.0E7; Longs and
// Integers as digits).
import { describe, expect, it } from 'vitest';
import { answerJson } from './answer.ts';
import type { ReactionDiagram } from './diagram.ts';
import type { ReactionGraph } from './reaction-graph.ts';

const EXPECTED =
  '{"diagram":{"isDisease":false,"displayName":"Binding","nodes":[{"id":6,' +
  '"reactomeId":535476,"displayName":"EXTL3","schemaClass":"EntityWithAccessionedSequence",' +
  '"renderableClass":"Protein","position":{"x":537.5,"y":66.0},"isDisease":true,' +
  '"minX":504.0,"minY":46.0,"maxX":571.0,"maxY":86.0,"prop":{"x":504.0,"y":46.0,' +
  '"width":67.0,"height":40.0},"nodeAttachments":[{"label":"P","reactomeId":77,' +
  '"shape":{"a":{"x":10.0,"y":20.0},"b":{"x":18.0,"y":28.0},"s":"P","type":"BOX",' +
  '"empty":true}},{"reactomeId":78,"shape":{"a":{"x":10.0,"y":20.0},"b":{"x":18.0,' +
  '"y":28.0},"type":"BOX","empty":true}}],"connectors":[{"edgeId":5,"isDisease":true,' +
  '"type":"OUTPUT","segments":[{"from":{"x":500.0,"y":66.0},"to":{"x":380.0,"y":-0.0}},' +
  '{"from":{"x":1.0E-4,"y":1.0E7},"to":{"x":0.5,"y":2.25}}],' +
  '"endShape":{"a":{"x":493.07179676972453,"y":70.0},"b":{"x":500.0,"y":66.0},' +
  '"c":{"x":493.07179676972453,"y":62.0},"type":"ARROW","empty":false},' +
  '"stoichiometry":{"value":2}},{"edgeId":5,"type":"INPUT","segments":[{"from":{"x":81.0,' +
  '"y":41.0},"to":{"x":93.0,"y":66.0}}],"stoichiometry":{"value":1,"shape":{"a":{"x":1.0,' +
  '"y":2.0},"b":{"x":3.0,"y":4.0},"s":"2","type":"BOX","empty":true}}}],"trivial":true,' +
  '"needDashedBorder":true},{"id":7,"reactomeId":29356,"displayName":"H2O",' +
  '"schemaClass":"SimpleEntity","renderableClass":"Chemical","position":{"x":46.5,' +
  '"y":66.0},"minX":20.0,"minY":41.0,"maxX":73.0,"maxY":91.0,"prop":{"x":20.0,"y":41.0,' +
  '"width":53.0,"height":50.0}}],"edges":[{"id":5,"reactomeId":1791144,' +
  '"displayName":"Binding","schemaClass":"Reaction","renderableClass":"Reaction",' +
  '"position":{"x":259.0,"y":66.0},"isDisease":false,"minX":253.0,"minY":60.0,"maxX":265.0,' +
  '"maxY":72.0,"segments":[{"from":{"x":233.0,"y":66.0},"to":{"x":253.0,"y":66.0}}],' +
  '"reactionShape":{"c":{"x":259.0,"y":66.0},"r":6.0,"type":"CIRCLE"},"inputs":[{"id":7,' +
  '"stoichiometry":1}],"outputs":[{"id":6,"stoichiometry":2}]}],"compartments":[{"id":8,' +
  '"displayName":"cytosol","schemaClass":"Compartment","renderableClass":"Compartment",' +
  '"position":{"x":300.0,"y":120.5},"minX":10.0,"minY":20.0,"maxX":590.0,"maxY":221.0,' +
  '"prop":{"x":10.0,"y":20.0,"width":580.0,"height":201.0},"textPosition":{"x":-4.0,' +
  '"y":2.0},"componentIds":[6,5]}],"dbId":1791144,"stableId":"R-HSA-1791144","minX":0,' +
  '"maxX":610,"minY":-3,"maxY":241},"graph":{"dbId":1791144,"stId":"R-HSA-1791144",' +
  '"displayName":"Binding","speciesName":"Homo sapiens","nodes":[{"parents":[11],' +
  '"children":[12,13],"identifier":"P17861-2","geneNames":["XBP1","TREB5"],"diagramIds":[6,' +
  '9],"dbId":535476,"stId":"R-HSA-535476","displayName":"EXTL3 [nucleoplasm]",' +
  '"schemaClass":"EntityWithAccessionedSequence","speciesID":48887},{"dbId":29356,' +
  '"stId":"R-ALL-29356","displayName":"H2O [cytosol]","schemaClass":"SimpleEntity",' +
  '"speciesID":0}],"edges":[{"preceding":[381203],"inputs":[29356],"outputs":[535476],' +
  '"diagramIds":[1791144],"dbId":1791144,"stId":"R-HSA-1791144","displayName":"Binding",' +
  '"schemaClass":"Reaction","entityFunctionalStatus":[14],"speciesID":0}]}}';

const xy = (x: number, y: number) => ({ x, y });
const segment = (a: number, b: number, c: number, d: number) => ({ from: xy(a, b), to: xy(c, d) });
const prop = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const box = (s?: string) => ({
  a: xy(10, 20),
  b: xy(18, 28),
  ...(s === undefined ? {} : { s }),
  type: 'BOX' as const,
  empty: true,
});

/** The objects EXPECTED was written from, as node holds them. */
function diagram(): ReactionDiagram {
  return {
    isDisease: false,
    displayName: 'Binding',
    nodes: [
      {
        id: 6,
        reactomeId: 535476,
        displayName: 'EXTL3',
        schemaClass: 'EntityWithAccessionedSequence',
        renderableClass: 'Protein',
        position: xy(537.5, 66),
        minX: 504,
        minY: 46,
        maxX: 571,
        maxY: 86,
        isDisease: true,
        trivial: true,
        needDashedBorder: true,
        prop: prop(504, 46, 67, 40),
        connectors: [
          {
            edgeId: 5,
            type: 'OUTPUT',
            segments: [segment(500, 66, 380, -0), segment(1e-4, 1e7, 0.5, 2.25)],
            endShape: {
              a: xy(493.07179676972453, 70),
              b: xy(500, 66),
              c: xy(493.07179676972453, 62),
              type: 'ARROW',
              empty: false,
            },
            stoichiometry: { value: 2 },
            isDisease: true,
          },
          {
            edgeId: 5,
            type: 'INPUT',
            segments: [segment(81, 41, 93, 66)],
            endShape: null,
            stoichiometry: {
              value: 1,
              shape: { a: xy(1, 2), b: xy(3, 4), s: '2', type: 'BOX', empty: true },
            },
            isDisease: null,
          },
        ],
        nodeAttachments: [
          { label: 'P', reactomeId: 77, shape: box('P') },
          // An empty label is left out, as BoxImpl's null text is.
          { label: '', reactomeId: 78, shape: box() },
        ],
      },
      {
        id: 7,
        reactomeId: 29356,
        displayName: 'H2O',
        schemaClass: 'SimpleEntity',
        renderableClass: 'Chemical',
        position: xy(46.5, 66),
        minX: 20,
        minY: 41,
        maxX: 73,
        maxY: 91,
        isDisease: null,
        trivial: null,
        needDashedBorder: null,
        prop: prop(20, 41, 53, 50),
        connectors: [],
        nodeAttachments: [],
      },
    ],
    edges: [
      {
        id: 5,
        reactomeId: 1791144,
        displayName: 'Binding',
        schemaClass: 'Reaction',
        renderableClass: 'Reaction',
        position: xy(259, 66),
        minX: 253,
        minY: 60,
        maxX: 265,
        maxY: 72,
        isDisease: false,
        segments: [segment(233, 66, 253, 66)],
        reactionShape: { c: xy(259, 66), r: 6, type: 'CIRCLE' },
        inputs: [{ id: 7, stoichiometry: 1 }],
        outputs: [{ id: 6, stoichiometry: 2 }],
        catalysts: [],
        inhibitors: [],
        activators: [],
      },
    ],
    compartments: [
      {
        id: 8,
        reactomeId: null,
        displayName: 'cytosol',
        schemaClass: 'Compartment',
        renderableClass: 'Compartment',
        position: xy(300, 120.5),
        minX: 10,
        minY: 20,
        maxX: 590,
        maxY: 221,
        prop: prop(10, 20, 580, 201),
        textPosition: xy(-4, 2),
        componentIds: [6, 5],
      },
    ],
    dbId: 1791144,
    stableId: 'R-HSA-1791144',
    minX: 0,
    maxX: 610,
    minY: -3,
    maxY: 241,
  };
}

function graph(): ReactionGraph {
  return {
    dbId: 1791144,
    stId: 'R-HSA-1791144',
    displayName: 'Binding',
    speciesName: 'Homo sapiens',
    nodes: [
      {
        parents: [11],
        children: [12, 13],
        identifier: 'P17861-2',
        geneNames: ['XBP1', 'TREB5'],
        diagramIds: [6, 9],
        dbId: 535476,
        stId: 'R-HSA-535476',
        displayName: 'EXTL3 [nucleoplasm]',
        schemaClass: 'EntityWithAccessionedSequence',
        speciesID: 48887,
      },
      {
        parents: [],
        children: [],
        identifier: null,
        geneNames: [],
        diagramIds: null,
        dbId: 29356,
        stId: 'R-ALL-29356',
        displayName: 'H2O [cytosol]',
        schemaClass: 'SimpleEntity',
        speciesID: 0,
      },
    ],
    edges: [
      {
        preceding: [381203],
        following: [],
        inputs: [29356],
        outputs: [535476],
        catalysts: [],
        inhibitors: [],
        activators: [],
        requirements: [],
        diagramIds: [1791144],
        efs: [14],
        dbId: 1791144,
        stId: 'R-HSA-1791144',
        displayName: 'Binding',
        schemaClass: 'Reaction',
        speciesId: 0,
      },
    ],
    subpathways: [],
  };
}

describe('answerJson', () => {
  it("writes Jackson's text for the deployed classes, byte for byte", () => {
    expect(answerJson(diagram(), graph())).toBe(EXPECTED);
  });

  it('leaves out null, empty text and empty lists, and writes 0 and false', () => {
    const text = answerJson(diagram(), graph());
    expect(text).not.toContain('"label":""');
    expect(text).not.toContain('[]');
    expect(text).not.toContain('null');
    expect(text).toContain('"speciesID":0');
    expect(text).toContain('"isDisease":false');
  });

  it("writes a Double as Java's Double.toString and a Long as its digits", () => {
    const text = answerJson(diagram(), graph());
    for (const written of ['"y":66.0', '"y":-0.0', '"x":1.0E-4', '"y":1.0E7', '"r":6.0'])
      expect(text).toContain(written);
    for (const written of ['"minX":0,', '"minY":-3,', '"value":2', '"stoichiometry":1}'])
      expect(text).toContain(written);
  });
});
