export interface Query {
  methodName: string;
  datasets: Dataset[];
  parameters: Parameter[];
}

export interface Dataset {
  data: string;
  design: DataInformation;
  name: string;
  type: string;
  parameters?: Parameter[];
}

export interface DataInformation {
  analysisGroup: string[];
  comparison: Comparison;
  samples: string[];

  [covariant: string]: string[] | Comparison;
}

interface Comparison {
  group1: string;
  group2: string;
}

export interface Parameter {
  name: string;
  /** As sent: every value as its text (submittedParameters). */
  value: string;
}
