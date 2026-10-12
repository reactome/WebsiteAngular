/**
 * A diagram's .graph.json, typed as the files are written: a field the
 * exporter has nothing for is left out. Measured over 42 diagrams of release
 * 97 (#344).
 */
export namespace Graph {
  export interface Data {
    dbId: number;
    stId: string;
    speciesName: string;
    edges: Edge[];
    nodes: Node[];
    /** Only on a diagram with subpathways (12 of 42). */
    subpathways?: SubPathway[];
  }

  export type Entity = {
    dbId: number;
    stId: string;
    displayName: string;
  };

  export interface Edge extends Entity {
    schemaClass: string;
  }

  export interface Node extends Entity {
    diagramIds?: number[];
    /** Only on entities with a reference (2,977 of 4,804 nodes). */
    identifier?: string;
    parents?: number[];
    children?: number[];
    schemaClass: string;
    referenceType?: string;
    leaves?: Node[];
    standardIdentifier?: string;
    chebiIdentifier?: string;
  }

  export interface SubPathway extends Entity {
    events: number[];
  }
}
