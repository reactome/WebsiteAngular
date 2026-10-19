export interface PathwayBrowserNode {
  stId: string;
  name: string;
  species: string;
  url: string;
  type: string;
  diagram: boolean;
  children?: PathwayBrowserNode[];
}
