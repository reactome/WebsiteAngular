import { Component, computed, input, inject } from '@angular/core';
import { CatalystActivityReference } from '../../../model/graph/control-reference/catalyst-activity-reference.model';
import { CatalystActivity } from '../../../model/graph/catalyst-activity.model';
import type { Relationship } from '../../../model/graph/relationship.model';
import { Regulation } from '../../../model/graph/Regulation/regulation.model';
import { IconService } from '../../../services/icon.service';
import { RegulationReference } from '../../../model/graph/control-reference/regulation-reference.model';
import {
  type Classed,
  getProperty,
  isCatalystActivity,
  isFragmentModification,
  isHasModifiedResidue,
  isPhysicalEntity,
  isReferenceGroup,
  isReferenceMolecule,
  isRegulation,
  isReplacedResidue,
} from '../../../services/utils';
import { MolecularProcess } from '../../../model/graph/molecular-process.model';
type HasModifiedResidue = Relationship.HasModifiedResidue;
import { ObjectTreeComponent } from '../object-tree/object-tree.component';
import { MatIcon } from '@angular/material/icon';
import { SortByDatePipe } from '../../../pipes/sort-by-date.pipe';
import { FormatClassNamePipe } from '../../../pipes/format-class-name.pipe';
import { PublicationComponent } from '../publication/publication.component';
import { OntologyTermComponent } from '../ontology-term/ontology-term.component';

@Component({
  selector: 'cr-molecular-process',
  standalone: true,
  templateUrl: './molecular-process.component.html',
  styleUrl: './molecular-process.component.scss',
  imports: [
    ObjectTreeComponent,
    MatIcon,
    SortByDatePipe,
    FormatClassNamePipe,
    PublicationComponent,
    OntologyTermComponent,
  ],
})
/**
 * This is a shared component for regulation, catalystActivity and modifiedResidue(modifications)
 */
export class MolecularProcessComponent {
  private iconService = inject(IconService);

  readonly entries = input.required<(Regulation | CatalystActivity | HasModifiedResidue)[]>();
  // Most events have neither.
  readonly catalystActivityReference = input<CatalystActivityReference>();
  readonly regulationRefs = input<RegulationReference[]>();

  readonly perspective = input<'entity' | 'event'>('event');

  getSymbol(obj: Classed) {
    return this.iconService.getIconDetails(obj);
  }

  readonly data = computed(() => this.getData());

  getData(): MolecularProcess[] {
    return this.entries().map((entry) => {
      if (isRegulation(entry)) {
        return this.getRegulation(entry);
      } else if (isCatalystActivity(entry)) {
        return this.getCatalystActivity(entry);
      } else if (isHasModifiedResidue(entry)) {
        return this.getModifiedResidue(entry);
      } else {
        return {} as MolecularProcess;
      }
    });
  }

  private getRegulation(entry: Regulation): MolecularProcess {
    return {
      dbId: entry.dbId,
      schemaClass: entry.schemaClass,
      type:
        this.perspective() === 'event'
          ? entry.schemaClass.includes('Negative')
            ? 'Negative Regulation'
            : 'Positive Regulation'
          : entry.schemaClass.includes('Negative')
            ? 'Negatively Regulates'
            : 'Positively Regulates',
      reactions: entry.regulatedEntity,
      go_BiologicalProcess: entry.activity,
      activeUnit: entry.activeUnit,
      regulator: entry.regulator,
      regulationReference: this.regulationRefs(),
      isRegulation: true,
      displayName: 'Faked',
    };
  }

  private getCatalystActivity(entry: CatalystActivity): MolecularProcess {
    return {
      dbId: entry.dbId,
      schemaClass: entry.schemaClass,
      reactions: entry.catalyzedEvent,
      type: 'Catalysis',
      activity: entry.activity,
      ecNumber: entry.activity?.ecNumber,
      activeUnit: entry.activeUnit,
      catalyst: entry.physicalEntity,
      catalystActivityReference: this.catalystActivityReference(),
      isCatalystActivity: true,
      displayName: 'Faked',
    };
  }

  private getModifiedResidue(entry: HasModifiedResidue) {
    let psiMods = getProperty(entry.element, 'psiMod');

    if (psiMods) {
      psiMods = Array.isArray(psiMods) ? psiMods : [psiMods]; // Ensure it's always an array
    } else {
      psiMods = undefined;
    }

    return {
      displayName: entry.element.displayName,
      schemaClass: entry.element.schemaClass,
      name: entry.element.displayName,
      psiMod: psiMods,
      coordinate: getProperty(entry.element, 'coordinate'),
      modification: getProperty(entry.element, 'modification'),
      literatureReference: [],
      isModification: true,
    } as unknown as MolecularProcess;
  }

  protected readonly isReferenceGroup = isReferenceGroup;
  protected readonly isPhysicalEntity = isPhysicalEntity;
  protected readonly isReplacedResidue = isReplacedResidue;
  protected readonly isFragmentModification = isFragmentModification;
  protected readonly isReferenceMolecule = isReferenceMolecule;
}
