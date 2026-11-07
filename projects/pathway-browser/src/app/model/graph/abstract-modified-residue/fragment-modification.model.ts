import type { FragmentDeletionModification } from './fragment-deletion-modification.model';
import type { FragmentInsertionModification } from './fragment-insertion-modification.model';
import type { FragmentReplacedModification } from './ fragment-replaced-modification.model';

/** A fragment modification of any of its three kinds. */
export type FragmentModification =
  FragmentDeletionModification | FragmentInsertionModification | FragmentReplacedModification;
