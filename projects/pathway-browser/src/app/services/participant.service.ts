import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ReferenceEntity } from '../model/graph/reference-entity/reference-entity.model';
import { CONTENT_SERVICE } from '../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { PropertyType } from '../model/property-type';
import { nameAfterIdentifier, nameBeforeIdentifier } from './utils';
import { SchemaClasses } from '../constants/constants';
import type { Participant, ShownParticipant } from '../model/participant.model';
import type { ParticipantReference } from '../../../../contract/participants.ts';

@Injectable({
  providedIn: 'root',
})
export class ParticipantService {
  private http = inject(HttpClient);

  getParticipants(stId: string): Observable<ShownParticipant[]> {
    const url = `${CONTENT_SERVICE}/data/participants/${stId}`;
    return this.http.get<Participant[]>(url).pipe(
      map((participants) =>
        participants.map((participant) => ({
          ...participant,
          refEntities: participant.refEntities.map((molecule) => ({
            ...molecule,
            formattedName: this.getNameAndType(molecule).name, // UniProt:P78396 CCNA1 ➡️ CCNA1
            type: this.getNameAndType(molecule).type,
            displayIcon: this.getDisplayIcon(molecule), // Correct DNA/RNA icon
          })),
        }))
      )
    );
  }

  getNameAndType(molecule: ParticipantReference): { type: string; name: string } {
    let type: string;
    let name: string;

    const schemaClass = molecule.schemaClass;
    switch (schemaClass) {
      case SchemaClasses.EWAS:
      case SchemaClasses.REFERENCE_GENE_PRODUCT:
      case SchemaClasses.REFERENCE_ISOFORM:
        type = PropertyType.PROTEINS;
        name = nameAfterIdentifier(molecule.displayName);

        break;
      case SchemaClasses.REFERENCE_RNA_SEQUENCE:
      case SchemaClasses.REFERENCE_DNA_SEQUENCE:
        type = PropertyType.SEQUENCES;
        name = nameAfterIdentifier(molecule.displayName);

        break;
      case SchemaClasses.SIMPLE_ENTITY:
      case SchemaClasses.REFERENCE_MOLECULE:
        type = PropertyType.CHEMICAL_COMPOUNDS;
        name = nameBeforeIdentifier(molecule.displayName);

        break;
      case SchemaClasses.REFERENCE_THERAPEUTIC:
        type = PropertyType.DRUG;
        name = nameBeforeIdentifier(molecule.displayName);

        break;
      default:
        type = PropertyType.OTHERS;
        name = molecule.displayName;
    }

    return { type, name };
  }

  getDisplayIcon(molecule: ParticipantReference) {
    const schemaClass = molecule.schemaClass;
    if (schemaClass === SchemaClasses.REFERENCE_DNA_SEQUENCE) {
      return schemaClass;
    }
    if (schemaClass === SchemaClasses.REFERENCE_RNA_SEQUENCE) {
      return schemaClass;
    }
    return molecule.icon;
  }

  getReferenceEntities(stId: string): Observable<ReferenceEntity[]> {
    const url = `${CONTENT_SERVICE}/data/participants/${stId}/referenceEntities`;
    return this.http.get<ReferenceEntity[]>(url);
  }
}
