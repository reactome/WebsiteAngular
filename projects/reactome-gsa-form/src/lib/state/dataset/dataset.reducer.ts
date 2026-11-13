import { ActionReducer, createReducer, on } from '@ngrx/store';
import { datasetAdapter, DatasetState, initialState, PDataset } from './dataset.state';
import { datasetActions } from './dataset.actions';
import { DataSummary } from '../../model/load-dataset.model';
import { StatisticalDesign } from '../../model/dataset.model';
import { Subset } from '../../model/utils.model';
import { cp, transpose } from 'reactome-table';
import { EntityHelper, isDefined } from '../../utilities/utils';

const helper = new EntityHelper<PDataset, DatasetState>(datasetAdapter);

/**
 * A change to a dataset's statistical design, made once it has one
 * (initStatisticalDesign); before that, as for a dataset there is not, the
 * state is left as it is.
 */
function updateDesign(
  id: number,
  state: DatasetState,
  change: (design: StatisticalDesign, dataset: PDataset) => Partial<StatisticalDesign>
): DatasetState {
  const dataset = helper.fetch(id, state);
  const design = dataset?.statisticalDesign;
  if (!dataset || !design) return state;
  return datasetAdapter.updateOne(
    { id, changes: { statisticalDesign: { ...design, ...change(design, dataset) } } },
    state
  );
}

/** A change made from a dataset's summary, once it has one (it is loaded, or uploaded). */
function fromSummary(
  id: number,
  state: DatasetState,
  change: (summary: DataSummary) => Partial<PDataset>
): DatasetState {
  const summary = helper.fetch(id, state)?.summary;
  return summary ? datasetAdapter.updateOne({ id, changes: change(summary) }, state) : state;
}

export const datasetReducer: ActionReducer<DatasetState> = createReducer(
  initialState,
  on(datasetActions.add, (state) =>
    datasetAdapter.addOne(
      { id: state.lastId, saved: false },
      {
        ...state,
        lastId: state.lastId + 1,
      }
    )
  ),
  on(datasetActions.delete, (state, { id }) => datasetAdapter.removeOne(id, state)),
  on(datasetActions.reset, (state) => datasetAdapter.removeAll(state)),
  on(datasetActions.clear, (state, { id }) => datasetAdapter.setOne({ id, saved: false }, state)),
  on(datasetActions.save, (state, { id }) =>
    datasetAdapter.updateOne({ id, changes: { saved: true } }, state)
  ),
  on(datasetActions.load, (state, { id }) =>
    datasetAdapter.updateOne(
      {
        id,
        changes: {
          loadingStatus: {
            id: 'unknown',
            status: 'pending',
            description: 'Sending load request to server',
          },
          public: true,
        },
      },
      state
    )
  ),
  on(datasetActions.uploadRibo, (state, { id }) =>
    datasetAdapter.updateOne(
      {
        id,
        changes: {
          loadingStatus: {
            id: 'unknown',
            status: 'pending',
            description: 'Sending your data to servers',
          },
          public: false,
        },
      },
      state
    )
  ),
  on(datasetActions.upload, (state, { id }) =>
    datasetAdapter.updateOne(
      {
        id,
        changes: {
          loadingStatus: {
            id: 'unknown',
            status: 'pending',
            description: 'Sending your data to servers',
          },
          public: false,
        },
      },
      state
    )
  ),
  on(datasetActions.loadSubmitted, (state, { loadingId, id }) =>
    datasetAdapter.updateOne(
      {
        id,
        changes: {
          loadingStatus: {
            id: loadingId,
            status: 'running',
          },
        },
      },
      state
    )
  ),
  // The progress dialog shows this until it closes, so a failure must say so
  // rather than leave it on "Sending request" or "Dataset loaded".
  on(datasetActions.uploadError, (state, { id }) =>
    failed(state, id, 'Your data could not be uploaded')
  ),
  on(datasetActions.loadSubmittedError, datasetActions.getSummaryError, (state, { id }) =>
    failed(state, id, 'The dataset could not be loaded')
  ),
  on(datasetActions.setLoadStatus, (state, { loadingStatus, id }) =>
    datasetAdapter.updateOne(
      {
        id,
        changes: { loadingStatus },
      },
      state
    )
  ),
  on(datasetActions.setSummary, (state, { summary, id }) =>
    datasetAdapter.updateOne(
      {
        id,
        changes: { summary, originalTitle: summary.title },
      },
      state
    )
  ),
  on(datasetActions.setAnnotations, (state, { annotations, id }) =>
    datasetAdapter.updateOne(
      {
        id,
        changes: {
          annotations: annotations,
        },
      },
      state
    )
  ),

  on(datasetActions.initAnnotationColumns, (state) =>
    datasetAdapter.updateMany(
      state.ids
        .map((id) => state.entities[id])
        .filter(isDefined)
        // Each that has its annotations (loaded with its summary).
        .flatMap((dataset) => {
          const annotations = dataset.annotations;
          if (!annotations) return [];

          const annotationsWithSimpleIds = cp(annotations);
          const [header] = annotationsWithSimpleIds;
          if (header) header[0] = 'sample_ids';

          return [
            {
              id: dataset.id,
              changes: {
                annotationColumns: new Map<string, string[]>(
                  transpose(annotationsWithSimpleIds).map((col) => [col[0] ?? '', col.slice(1)])
                ),
              },
            },
          ];
        }),
      state
    )
  ),

  on(datasetActions.uploadComplete, (state, { uploadData, name, typeId, id }) =>
    datasetAdapter.updateOne(
      {
        id,
        changes: {
          summary: {
            id: uploadData.data_token,
            title: name,
            type: typeId,
            sample_ids: uploadData.sample_names,
          },
        },
      },
      state
    )
  ),
  on(datasetActions.updateSummary, (state, { update }) =>
    helper.update(update.id, state, (dataset) => ({
      summary: {
        ...dataset.summary,
        ...(update.changes as Subset<DataSummary>),
      },
    }))
  ),

  on(datasetActions.initStatisticalDesign, (state, { id }) =>
    fromSummary(id, state, (summary) => {
      const defaultCovariances = new Set<string>(
        (summary.default_parameters || [])
          .find((param) => param.name === 'covariates')
          ?.value.split(',')
      );
      const defaultGroup1 = (summary.default_parameters || []).filter(
        (param) => param.name === 'comparison_group_1'
      )[0]?.value;
      const defaultGroup2 = (summary.default_parameters || []).filter(
        (param) => param.name === 'comparison_group_2'
      )[0]?.value;
      const defaultComparisonFactor = (summary.default_parameters || []).filter(
        (param) => param.name === 'analysis_group'
      )[0]?.value;

      return {
        statisticalDesign: {
          analysisGroup: defaultComparisonFactor,
          comparisonGroup1: defaultGroup1,
          comparisonGroup2: defaultGroup2,
          defaultCovariances,
          defaultGroup1,
          defaultGroup2,
          defaultComparisonFactor,
          covariances: [],
        },
      };
    })
  ),

  on(datasetActions.initCovariances, (state, { id }) =>
    updateDesign(id, state, (design, dataset) => ({
      covariances:
        dataset.annotations?.[0]
          ?.slice(1) //slice the first element, which is the empty string
          .filter((name) => name !== design.analysisGroup)
          .map((name) => ({
            name,
            value: design.defaultCovariances.has(name),
          })) || [],
    }))
  ),

  on(datasetActions.setAnalysisGroup, (state, { group, id }) =>
    updateDesign(id, state, (design) => ({
      analysisGroup: group,
      comparisonGroup1: group === design.defaultComparisonFactor ? design.defaultGroup1 : undefined,
      comparisonGroup2: group === design.defaultComparisonFactor ? design.defaultGroup2 : undefined,
    }))
  ),

  on(datasetActions.setComparisonGroup1, (state, { group, id }) =>
    updateDesign(id, state, () => ({ comparisonGroup1: group }))
  ),

  on(datasetActions.setComparisonGroup2, (state, { group, id }) =>
    updateDesign(id, state, () => ({ comparisonGroup2: group }))
  ),

  on(datasetActions.setCovariateValue, (state, { group, value, id }) =>
    updateDesign(id, state, (design) => ({
      covariances: design.covariances.map((cov) => (cov.name === group ? { ...cov, value } : cov)),
    }))
  ),

  on(datasetActions.lockCovariateValue, (state, { group, value, id, locked }) =>
    updateDesign(id, state, (design) => ({
      covariances: design.covariances.map((cov) =>
        cov.name === group ? { ...cov, value, locked } : cov
      ),
    }))
  ),

  on(datasetActions.setCovariatesValue, (state, { value, id }) =>
    updateDesign(id, state, (design) => ({
      covariances: design.covariances.map((cov) => ({
        ...cov,
        value: cov.locked ? cov.value : value,
      })),
    }))
  ),

  on(datasetActions.setSummaryParameters, (state, { id, parameters }) =>
    fromSummary(id, state, (summary) => ({ summary: { ...summary, parameters } }))
  ),

  on(datasetActions.resetSummaryParameters, (state, { id }) =>
    fromSummary(id, state, (summary) => {
      return {
        summary: {
          ...summary,
          ...(summary.parameters && {
            parameters: summary.parameters.map((p) => ({ ...p, value: p.default })),
          }),
        },
      };
    })
  )
);

function failed(state: DatasetState, id: number, description: string): DatasetState {
  return datasetAdapter.updateOne(
    {
      id,
      changes: {
        loadingStatus: {
          id: state.entities[id]?.loadingStatus?.id ?? 'unknown',
          status: 'failed',
          description,
        },
      },
    },
    state
  );
}
