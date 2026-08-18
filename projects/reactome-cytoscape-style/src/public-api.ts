/*
 * Public API Surface of reactome-cytoscape-style
 */

export { Style, interactivityOf } from './lib/style';
export type { UserProperties } from './lib/properties';
export { Interactivity } from './lib/interactivity';
export * as Types from './lib/types';
export { ReactomeEvent, ReactomeEventTypes } from './lib/model/reactome-event.model';
export type { ReactomeEventTarget } from './lib/model/reactome-event.model';
export { extract, propertyExtractor } from './lib/properties-utils';
