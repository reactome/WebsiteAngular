import {createEntityAdapter, EntityState} from "@ngrx/entity";
import {PartialRequired} from "../../model/utils.model";
import {Parameter} from "../../model/parameter.model";

export type Source = 'External' | 'Local' | 'Example';

export interface DatasetSource {
  description: string;
  id: string;
  name: string;
  group: string;
  title: string;
  data_types: string[];
  type: string;
  doc_link: string;
  parameters: Parameter[];
  source: Source;
  url: string;
}

export type PDatasetSource = PartialRequired<DatasetSource, 'description' | 'name' | 'id' | 'source'>;


export interface DatasetSourceState extends EntityState<PDatasetSource> {
  selectedSourceId: string | null
}

export const datasetSourceAdapter = createEntityAdapter<PDatasetSource>();

// NgRx 20 narrowed getInitialState() to accept only the state's own extra keys
// (Omit<S, keyof EntityState<T>>), so ids/entities can no longer be seeded by
// hand. Adding the entity through the adapter is equivalent and keeps the
// ids/entities invariants consistent.
export const initialState: DatasetSourceState = datasetSourceAdapter.addOne(
  {
    id: 'search',
    name: 'Search',
    description: 'Search across Expression Atlas and GREIN dataset',
    data_types: ['rnaseq_counts', 'proteomics_int', 'microarray_norm'],
    source: 'External'
  },
  datasetSourceAdapter.getInitialState({
    selectedSourceId: null
  })
);

