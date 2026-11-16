// Where an object sits in the Pathway Browser (spec 016, T024): the trees of
// /data/detail/{id}/locationsInPWB, from each top-level pathway down to the
// object, which the site's locations tree draws.

/**
 * One node of a tree, measured over 179 recorded answers (1,694 nodes): no
 * node carries `diagram`, so it is not described, and a species-less object
 * (a SimpleEntity, a ChemicalDrug) has no `species`. `stId`, `name`, `url` and
 * `type` are in every one; the service, as Java, would leave out a null one.
 */
export interface PathwayBrowserNode {
  stId: string;
  name: string;
  species?: string;
  /**
   * The Pathway Browser's link to the node, in the old browser's form and
   * HTML-escaped as Java writes it (`#/R-HSA-1&amp;SEL=R-HSA-2&amp;PATH=...`):
   * unescape it before using it as an address (the site's locations tree does,
   * in `withBrowserLinks`), or the browser cannot read it and opens empty.
   */
  url: string;
  /** The node's schema class. */
  type: string;
  /** Left out when there are none. */
  children?: PathwayBrowserNode[];
}
