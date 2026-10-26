// As /data/detail/{id}/locationsInPWB writes it, measured over 179 recorded
// answers (1,694 nodes): no node carries `diagram`, and a species-less object
// (a SimpleEntity, a ChemicalDrug) has no `species`.
export interface PathwayBrowserNode {
  stId: string;
  name: string;
  species?: string;
  url: string;
  type: string;
  children?: PathwayBrowserNode[];
}
