import { DataSummary } from './load-dataset.model';
import { CellInfo } from 'reactome-table';

export class DatasetTable {
  constructor(
    public columns: string[],
    public rows: string[],
    public dataset: CellInfo[][]
  ) {}
}

export interface StatisticalDesign {
  // Undefined when the dataset's summary gives none.
  defaultComparisonFactor?: string | undefined;
  defaultGroup1?: string | undefined;
  defaultGroup2?: string | undefined;
  defaultCovariances: Set<string>;

  analysisGroup?: string | undefined;
  // Set to undefined on purpose: choosing another analysis group clears them.
  comparisonGroup1?: string | undefined;
  comparisonGroup2?: string | undefined;
  covariances: Covariate[];
}

export interface Covariate {
  name: string;
  value: boolean;
  locked?: boolean;
}

export interface Dataset {
  saved: boolean;
  summary?: DataSummary;
  table?: DatasetTable;
  statisticalDesign?: StatisticalDesign;
}
