export interface Summaries {
  summaries: Summary[];
}

export interface Summary {
  id: number;
  name: string;
  description: string;
  resource: string;
  url: string;
  timestamp: string;
  numberOfGenes: number;
  tissuesMap: Record<string, number>;
}

/** A sample's request parameters: a type, so they can be sent as the request's parameters. */
export type SampleParams = {
  omitNulls?: boolean;
  included: number[];
};
