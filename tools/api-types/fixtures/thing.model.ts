// A small type for the compile helper's own tests (compile.spec.mjs).
export interface Thing {
  id: number;
  name: string;
  tags?: string[];
  child?: Thing;
  'odd key'?: boolean;
}
