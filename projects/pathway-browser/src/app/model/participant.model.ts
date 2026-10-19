export interface Molecule {
  dbId: number;
  identifier: string;
  schemaClass: string;
  displayName: string;
  icon: string;
  displayIcon: string;
  url: string;
  formattedName: string;
  type: string;
}

export interface Participant {
  peDbId: number;
  displayName: string;
  schemaClass: string;
  refEntities: Molecule[];
}
