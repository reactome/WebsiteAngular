import { describe, expect, it } from 'vitest';
import { analysisReducer } from './analysis.reducer';
import { analysisActions } from './analysis.actions';
import { initialState } from './analysis.state';
import { refusal } from '../../services/analysis.service';

const failedWith = (error: unknown) =>
  analysisReducer(initialState, analysisActions.loadFailure({ error })).analysisLoadingStatus;

// The errors were typed `any`; what a failed submission shows is unchanged.
describe('a failed submission', () => {
  it("shows the service's or the form's reason", () => {
    expect(failedWith(refusal('The statistical design is not complete'))).toMatchObject({
      status: 'failed',
      description: 'The statistical design is not complete',
    });
  });

  it("shows the form's own error by its message", () => {
    expect(failedWith(new TypeError('x is undefined'))?.description).toBe('x is undefined');
  });
});
