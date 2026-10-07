/**
 * Kinds of property the molecule tab groups participants by.
 *
 * Here rather than in the molecule tab's component: ParticipantService needs
 * it, and importing it from the component pulled the whole details panel's
 * view tree -- trees, structure viewer, forms -- into every bundle that uses
 * the service, the embeddable diagram's among them.
 */
export enum PropertyType {
  PROTEINS = 'Proteins',
  CHEMICAL_COMPOUNDS = 'Chemical Compounds',
  SEQUENCES = 'DNA/RNA',
  DRUG = 'Drugs',
  OTHERS = 'Others',
}
