// declare module "@carrotsearch/foamtree";
declare module "@carrotsearch/foamtree" {
  export interface FoamTreePosition {
    x: number;
    y: number;
    zoom: number;
  }

  export interface FoamTreeDataObject {
    id?: string;
    label?: string;
    weight?: number;
    groups?: FoamTreeDataObject[];
    [key: string]: any;
  }

  export interface FoamTreeOptions {
    [key: string]: any;
    initialPosition?: any;
  }

  export class FoamTree<T extends FoamTreeDataObject = FoamTreeDataObject> {
    constructor(options?: FoamTreeOptions);

    set(key: string, value: any): void;
    set(options: Record<string, any>): void;

    get(key: any, options?: any): any;
    get(options: Record<string, any>): any;

    drawTo(key: string, value: any): void;
    drawTo(options: Record<string, any>): void;

    dispose(): void;

    redraw(): void;

    expose(key: string | Record<string, any>): Promise<any>;

    select(key: any, value?: any): void;

    resize(): void;
  }

  export namespace FoamTree {
    export type Position = any;
    export type DataObject = any;
    export type ImageFormat = any;
    export type InitialOptions<T extends FoamTreeDataObject = FoamTreeDataObject> = FoamTreeOptions & Record<string, any>;
  }
}
