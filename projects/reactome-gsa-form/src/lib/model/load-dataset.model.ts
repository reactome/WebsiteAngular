import { Report } from './report-status.model';
import { PartialRequired } from './utils.model';
import { Parameter } from './parameter.model';

export interface LoadingStatus {
  completed: number;
  dataset_id: string;
  description: string;
  id: string;
  reports: Report[];
  status: 'failed' | 'complete' | 'running' | 'pending';
}

export type PLoadingStatus = PartialRequired<LoadingStatus, 'id' | 'status'>;

export interface LoadParameter {
  name: string;
  /** As sent: the value's text. */
  value: string;
}

export interface SampleMetadata {
  name: string;
  values: string[];
}

export class DataSummary {
  id!: string;
  title!: string;
  type!: string;
  description?: string;
  group?: string;
  sample_ids!: string[];
  sample_metadata?: SampleMetadata[];
  /** As the service sends them: each value its text (e2e/fixtures/gsa-melanoma-example.json). */
  default_parameters?: { name: string; value: string }[];
  parameters?: Parameter[];
  complete?: boolean = false;
}
