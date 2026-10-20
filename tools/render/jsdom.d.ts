// jsdom ships no types, and @types/jsdom has no release for jsdom 29: what
// pptx.spec.ts uses of it -- a window to parse XML with -- declared here.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    readonly window: Window & typeof globalThis;
  }
}
