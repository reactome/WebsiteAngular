import {
  Component,
  computed,
  effect,
  inject,
  input,
  OnDestroy,
  signal,
  Signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import type { Analysis } from '../../../model/analysis.model';
import { IconService } from '../../../services/icon.service';
import {
  getProperty,
  groupAndSortBy,
  isDefined,
  isDefinedAndNotEmpty,
  isPhysicalEntity,
  isReferenceSequence,
  isReferenceSummary,
  isRLE,
  observeSections,
} from '../../../services/utils';
import { DatabaseObject } from '../../../model/graph/database-object.model';
import { ReferenceEntity } from '../../../model/graph/reference-entity/reference-entity.model';
import { rxResource } from '@angular/core/rxjs-interop';
import { InstanceEdit } from '../../../model/graph/instance-edit.model';
import { LiteratureReference } from '../../../model/graph/publication/literature-reference.model';
import { SelectableObject } from '../../../services/event.service';
import { of } from 'rxjs';
import { PhysicalEntity } from '../../../model/graph/physical-entity/physical-entity.model';
import { InteractorService } from '../../../interactors/services/interactor.service';
import { EntityService } from '../../../services/entity.service';
import { DataKeys, Labels } from '../../../constants/constants';
import { CatalystActivity } from '../../../model/graph/catalyst-activity.model';
import { CatalystActivityReference } from '../../../model/graph/control-reference/catalyst-activity-reference.model';
import { Regulation } from '../../../model/graph/Regulation/regulation.model';
import { RegulationReference } from '../../../model/graph/control-reference/regulation-reference.model';
import type { Relationship } from '../../../model/graph/relationship.model';
import { DatabaseIdentifier } from '../../../model/graph/database-identifier.model';
import { EntityWithAccessionedSequence } from '../../../model/graph/physical-entity/entity-with-accessioned-sequence.model';
import { MarkerReference } from '../../../model/graph/control-reference/marker-reference.model';
import { camelCase, isArray } from 'lodash';
import { UrlStateService } from '../../../services/url-state.service';
import {
  CONTENT_DETAIL,
  CONTENT_DETAIL_PATH,
  CONTENT_SCHEMA,
  environment,
} from '../../../../environments/environment';
import { SpeciesService } from '../../../services/species.service';
import { Summation } from '../../../model/graph/summation.model';
import { FigureService } from './figure/figure.service';
type HasModifiedResidue = Relationship.HasModifiedResidue;
import { KeyValuePipe, NgClass, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SortByTextPipe } from '../../../pipes/sort-by-text.pipe';
import { IncludeRefPipe } from '../../../pipes/include-ref.pipe';
import { AuthorshipDateFormatPipe } from '../../../pipes/authorship-date-format.pipe';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';
import { MatAnchor } from '@angular/material/button';
import { DescriptionOverviewComponent } from './description-overview/description-overview.component';
import { RefsTreeComponent } from '../../common/refs-tree/refs-tree.component';
import { PublicationComponent } from '../../common/publication/publication.component';
import { CrossReferencesComponent } from '../../common/cross-references/cross-references.component';
import { ExternalReferenceComponent } from '../../common/external-reference/external-reference.component';
import { ControllerTreeComponent } from '../../common/controller-tree/controller-tree.component';
import { MolecularProcessComponent } from '../../common/molecular-process/molecular-process.component';
import { CellMarkerComponent } from '../../common/cell-marker/cell-marker.component';
import { IconComponent } from './icon/icon.component';
import { RheaComponent } from '../../common/rhea/rhea.component';
import { InteractorsTableComponent } from '../../common/interactors-table/interactors-table.component';
import { LocationsTreeComponent } from '../../../../../../website-angular/src/app/content/detail/locations-tree/locations-tree.component';
import { ReactionDiagramComponent } from '../../common/reaction-diagram/reaction-diagram.component';

@Component({
  selector: 'cr-description-tab',
  templateUrl: './description-tab.component.html',
  styleUrl: './description-tab.component.scss',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    NgClass,
    KeyValuePipe,
    RouterLink,
    SortByTextPipe,
    IncludeRefPipe,
    AuthorshipDateFormatPipe,
    MatDivider,
    MatIcon,
    MatTooltip,
    MatSlideToggle,
    FormsModule,
    MatAnchor,
    DescriptionOverviewComponent,
    RefsTreeComponent,
    PublicationComponent,
    CrossReferencesComponent,
    ExternalReferenceComponent,
    ControllerTreeComponent,
    MolecularProcessComponent,
    CellMarkerComponent,
    IconComponent,
    RheaComponent,
    InteractorsTableComponent,
    LocationsTreeComponent,
    ReactionDiagramComponent,
  ],
})
export class DescriptionTabComponent implements OnDestroy {
  private iconService: IconService = inject(IconService);
  private entity: EntityService = inject(EntityService);
  public figure: FigureService = inject(FigureService);
  private interactorService: InteractorService = inject(InteractorService);
  public state: UrlStateService = inject(UrlStateService);
  private species: SpeciesService = inject(SpeciesService);
  icon = rxResource({
    request: () => this.referenceEntity()?.identifier,
    loader: (param) =>
      param.request ? this.iconService.fetchIcon(param.request) : of(null),
  });

  readonly figures = computed(() =>
    (this.obj().figure || []).filter((f) => !f.url.includes('ehld'))
  );
  readonly hasIllustration = computed(
    () => this.figures().length > 0 || this.icon.hasValue()
  );
  currentIcon = this.iconService.currentIcon;

  _otherForms = rxResource({
    request: () =>
      isPhysicalEntity(this.obj()) &&
      !isReferenceSummary(this.obj()) &&
      this.referenceEntity() &&
      this.obj().stId,
    loader: (param) =>
      param.request ? this.entity.getOtherForms(param.request) : of(null),
  });

  _interactors = rxResource({
    request: () =>
      isPhysicalEntity(this.obj()) && this.referenceEntity()?.identifier,
    loader: (param) =>
      param.request
        ? this.interactorService.getCustomInteractorsByAcc(param.request)
        : of(null),
  });

  readonly obj = input.required<SelectableObject>();
  readonly analysisResult = input<Analysis.Result>();
  readonly showLocations = input(false);
  readonly showReactionDiagram = input(true);

  static referenceTypeToNameSuffix = new Map<string, string>([
    ['ReferenceMolecule', ''],
    ['ReferenceGeneProduct', ''],
    ['ReferenceDNASequence', ' Gene'],
    ['ReferenceRNASequence', ' mRNA'],
    ['ReferenceTherapeutic', ' Drug'],
  ]);

  readonly isReferenceSummary = computed(() => isReferenceSummary(this.obj()));

  readonly name = computed(() => {
    const obj = this.obj();

    let name = obj.name
      ? isArray(obj.name)
        ? obj.name[0]
        : obj.name
      : obj.displayName;

    if (isReferenceSummary(obj)) {
      const suffix = DescriptionTabComponent.referenceTypeToNameSuffix.get(
        obj.referenceEntity.schemaClass
      );
      if (
        isReferenceSequence(obj.referenceEntity) &&
        isDefinedAndNotEmpty(obj.referenceEntity.geneName)
      )
        name = obj.referenceEntity.geneName[0];
      return obj.referenceEntity.schemaClass === 'ReferenceIsoform'
        ? `${name} Isoform ${obj.variantIdentifier} `
        : name + suffix;
    }

    return name;
  });

  readonly symbol = computed(() => this.getSymbol(this.obj()));
  readonly literatureRefs: Signal<LiteratureReference[]> = computed(() =>
    getProperty(this.obj(), DataKeys.LITERATURE_REFERENCE)
  );
  readonly groupedReferences = computed(() =>
    groupAndSortBy(
      this.literatureRefs(),
      (ref) => ref.year,
      (key1, key2) => key2 - key1
    )
  );

  readonly summations: Signal<Summation[]> = computed(() =>
    getProperty(this.obj(), DataKeys.SUMMATION)
  );
  readonly allRefs = computed(() => {
    const literatureRefs = this.literatureRefs();
    const summation = getProperty(
      this.obj(),
      DataKeys.SUMMATION
    ) as Summation[];
    return [
      ...(literatureRefs || []),
      ...(summation
        .flatMap((s) => s.literatureReference as LiteratureReference[])
        .filter(isDefined) || []),
    ];
  });

  referenceEntity: Signal<ReferenceEntity> = computed(() =>
    getProperty(this.obj(), DataKeys.REFERENCE_ENTITY)
  );

  readonly authorship: Signal<{ label: string; data: InstanceEdit[] }[]> =
    computed(() => {
      const arrayWrap = <E>(a: E[] | E) => (Array.isArray(a) ? a : [a]);

      const obj = this.obj();
      // Ensure it's an array, either returning the existing array or wrapping it in one, it complains without this line.
      const authored = arrayWrap(getProperty(obj, DataKeys.AUTHORED) || []);
      const reviewed = getProperty(obj, DataKeys.REVIEWED) || [];
      const edited = getProperty(obj, DataKeys.EDITED) || [];
      const revised = getProperty(obj, DataKeys.REVISED) || [];
      const created = arrayWrap(getProperty(obj, DataKeys.CREATED) || []);

      return [
        ...(authored.length > 0
          ? [{ label: Labels.AUTHOR, data: authored }]
          : []),
        ...(reviewed.length > 0
          ? [{ label: Labels.REVIEWER, data: reviewed }]
          : []),
        ...(edited.length > 0 ? [{ label: Labels.EDITOR, data: edited }] : []),
        ...(revised.length > 0
          ? [{ label: Labels.REVISER, data: revised }]
          : []),
        ...(created.length > 0 ? [{ label: 'Created', data: created }] : []),
      ];
    });

  inferences = computed(() => {
    const inferences: PhysicalEntity[] = getProperty(
      this.obj(),
      DataKeys.INFERRED_TO
    );
    if (!inferences) return new Map<string, PhysicalEntity[]>();
    return this.getGroupedInferences(inferences);
  });

  otherForms = computed(() => {
    const value = this._otherForms.value();
    if (!value) return new Map<string, PhysicalEntity[]>();
    return this.getGroupedOtherForms(value);
  });

  selectedOtherFormsCategory = signal<OtherFormsCategory>('all');
  selectedOtherFormsCompartment = signal<string>('all');
  selectedOtherFormsDisease = signal<OtherFormsDisease>('all');

  // Flat list of all other forms (compartment + entity pairs) used as the
  // source for both the row list and facet count computations.
  private otherFormsRows = computed<OtherFormsRow[]>(() => {
    const rows: OtherFormsRow[] = [];
    for (const [compartment, entities] of this.otherForms()) {
      for (const entity of entities) rows.push({ entity, compartment });
    }
    return rows;
  });

  // Facet counts cross-reflect the OTHER selected facets so that picking
  // "cytosol" updates the modification chip counts to the cytosol subset
  // (and so on). Each chip computes its own count by excluding only the
  // facet it lives on -- otherwise toggling a chip would zero its own count.

  otherFormsCategories = computed<OtherFormsFacet<OtherFormsCategory>[]>(() => {
    const crossRows = this.rowsFiltered({ excludeCategory: true });
    const crossCounts = new Map<OtherFormsCategory, number>();
    for (const r of crossRows) {
      const cat = categorizeOtherForm(r.entity);
      crossCounts.set(cat, (crossCounts.get(cat) || 0) + 1);
    }
    // Show every category that exists in the full dataset, even when the
    // cross-filtered count for it has dropped to 0. Otherwise the chip row
    // would collapse and users would lose orientation.
    const allKeys = new Set<OtherFormsCategory>();
    for (const r of this.otherFormsRows()) allKeys.add(categorizeOtherForm(r.entity));
    const cats: OtherFormsFacet<OtherFormsCategory>[] = [
      { key: 'all', label: 'All', count: crossRows.length },
    ];
    for (const [key, label] of OTHER_FORMS_CATEGORY_ORDER) {
      if (!allKeys.has(key)) continue;
      cats.push({ key, label, count: crossCounts.get(key) || 0 });
    }
    return cats;
  });

  otherFormsCompartmentFacets = computed<OtherFormsFacet<string>[]>(() => {
    const crossRows = this.rowsFiltered({ excludeCompartment: true });
    const crossCounts = new Map<string, number>();
    for (const r of crossRows) crossCounts.set(r.compartment, (crossCounts.get(r.compartment) || 0) + 1);
    // Preserve every compartment present in the full dataset, sorted by its
    // unfiltered size (so the row order stays stable across selections).
    const stableOrder = new Map<string, number>();
    for (const r of this.otherFormsRows()) {
      stableOrder.set(r.compartment, (stableOrder.get(r.compartment) || 0) + 1);
    }
    const sorted = [...stableOrder.entries()].sort((a, b) => b[1] - a[1]);
    return [
      { key: 'all', label: 'All compartments', count: crossRows.length },
      ...sorted.map(([key]) => ({ key, label: key, count: crossCounts.get(key) || 0 })),
    ];
  });

  otherFormsDiseaseFacets = computed<OtherFormsFacet<OtherFormsDisease>[]>(() => {
    const rows = this.rowsFiltered({ excludeDisease: true });
    let disease = 0;
    for (const r of rows) if (r.entity.inDisease) disease++;
    const reference = rows.length - disease;
    return [
      { key: 'all', label: 'All', count: rows.length },
      { key: 'disease', label: 'Disease variants', count: disease },
      { key: 'reference', label: 'Reference', count: reference },
    ];
  });

  // Whether the disease facet is meaningful at all for this entity:
  // it only matters when the *full* dataset contains both kinds. Computed
  // off the unfiltered rows so the facet doesn't blink off when a single
  // selection (e.g. cytosol) happens to contain only one kind.
  hasMixedDiseaseStatus = computed(() => {
    let hasD = false, hasR = false;
    for (const r of this.otherFormsRows()) {
      if (r.entity.inDisease) hasD = true; else hasR = true;
      if (hasD && hasR) return true;
    }
    return false;
  });

  filteredOtherFormsList = computed<OtherFormsRow[]>(() => this.rowsFiltered({}));

  private rowsFiltered(opts: {
    excludeCategory?: boolean;
    excludeCompartment?: boolean;
    excludeDisease?: boolean;
  }): OtherFormsRow[] {
    const cat = this.selectedOtherFormsCategory();
    const comp = this.selectedOtherFormsCompartment();
    const disease = this.selectedOtherFormsDisease();
    return this.otherFormsRows().filter((r) => {
      if (!opts.excludeCategory && cat !== 'all' && categorizeOtherForm(r.entity) !== cat) return false;
      if (!opts.excludeCompartment && comp !== 'all' && r.compartment !== comp) return false;
      if (!opts.excludeDisease && disease !== 'all') {
        if (disease === 'disease' && !r.entity.inDisease) return false;
        if (disease === 'reference' && r.entity.inDisease) return false;
      }
      return true;
    });
  }

  interactors = computed(() => this._interactors.value() || []);
  interactorsLength = computed(() => this._interactors.value()?.length || 0);

  catalystActivity: Signal<CatalystActivity[]> = computed(() =>
    getProperty(this.obj(), DataKeys.CATALYST_ACTIVITY)
  );
  catalystActivities: Signal<CatalystActivity[]> = computed(() =>
    getProperty(this.obj(), DataKeys.CATALYST_ACTIVITIES)
  );
  catalystRef: Signal<CatalystActivityReference> = computed(() =>
    getProperty(this.obj(), DataKeys.CATALYST_ACTIVITY_REFERENCE)
  );

  regulations: Signal<Regulation[]> = computed(() =>
    getProperty(this.obj(), DataKeys.REGULATED_BY)
  );
  regulationRefs: Signal<RegulationReference[]> = computed(() =>
    getProperty(this.obj(), DataKeys.REGULATION_REFERENCE)
  );

  regulates: Signal<Regulation[]> = computed(() => [
    ...(getProperty(this.obj(), DataKeys.POSITIVELY_REGULATES) || []),
    ...(getProperty(this.obj(), DataKeys.NEGATIVELY_REGULATES) || []),
  ]);

  modifications: Signal<HasModifiedResidue[]> = computed(() =>
    getProperty(this.obj(), DataKeys.MODIFIED_RESIDUES)
  );

  crossReference = computed(() => {
    if (this.referenceEntity() && this.referenceEntity().crossReference) {
      return this.referenceEntity().crossReference;
    }

    const crossReference: DatabaseIdentifier[] = getProperty(
      this.obj(),
      DataKeys.CROSS_REFERENCE
    );
    return crossReference ? [...crossReference] : [];
  });

  proteinMarkers: Signal<EntityWithAccessionedSequence[]> = computed(
    () => getProperty(this.obj(), DataKeys.PROTEIN_MARKER) || []
  );
  rnaMarkers: Signal<EntityWithAccessionedSequence[]> = computed(
    () => getProperty(this.obj(), DataKeys.RNA_MARKERS) || []
  );
  markerReference: Signal<MarkerReference[]> = computed(() =>
    getProperty(this.obj(), DataKeys.MARKER_REFERENCE)
  );

  repeatedUnits: Signal<PhysicalEntity[]> = computed(() =>
    getProperty(this.obj(), DataKeys.REPEATED_UNIT)
  );

  hasRhea = computed(() =>
    ['RHEA', 'Rhea'].includes(this.crossReference()[0]?.databaseName)
  );

  // Disable the navigation control for inferred event when there is no associated pathway
  // https://reactome.org/beta/PathwayBrowser/R-HSA-9931510?select=R-HSA-9909400&path=R-HSA-9909396#inferredFrom
  inferenceNavigationVisibility = computed(() => {
    const isHuman =
      this.species.currentSpecies().taxId === this.species.defaultSpecies.taxId;
    const isInferred = this.obj().isInferred;
    return isHuman && isRLE(this.obj()) && isInferred;
  });

  overview$ = viewChild<HTMLDivElement>('overview');
  overviewTemplate$ = viewChild.required<TemplateRef<any>>('overviewTemplate');
  referenceTemplate$ =
    viewChild.required<TemplateRef<any>>('referenceTemplate');
  modificationsTemplate$ = viewChild.required<TemplateRef<any>>(
    'modificationsTemplate'
  );
  crossReferencesTemplate$ = viewChild.required<TemplateRef<any>>(
    'crossReferencesTemplate'
  );
  markerTemplate$ = viewChild.required<TemplateRef<any>>('markerTemplate');
  regulationTemplate$ =
    viewChild.required<TemplateRef<any>>('regulationTemplate');
  regulatesTemplate$ =
    viewChild.required<TemplateRef<any>>('regulatesTemplate');
  catalystActivityTemplate$ = viewChild.required<TemplateRef<any>>(
    'catalystActivityTemplate'
  );
  catalystActivitiesTemplate$ = viewChild.required<TemplateRef<any>>(
    'catalystActivitiesTemplate'
  );
  inferencesTemplate$ =
    viewChild.required<TemplateRef<any>>('inferencesTemplate');
  otherFormsTemplate$ =
    viewChild.required<TemplateRef<any>>('otherFormsTemplate');
  literatureRefsTemplate$ = viewChild.required<TemplateRef<any>>(
    'literatureRefsTemplate'
  );
  authorsTemplate$ = viewChild.required<TemplateRef<any>>('authorsTemplate');
  interactorsTemplate$ = viewChild.required<TemplateRef<any>>(
    'interactorsTemplate'
  );
  rheaTemplate$ = viewChild.required<TemplateRef<any>>('rheaTemplate');
  locationsTemplate$ = viewChild<TemplateRef<any>>('locationsTemplate');
  reactionDiagramTemplate$ = viewChild<TemplateRef<any>>(
    'reactionDiagramTemplate'
  );

  readonly isReaction = computed(() => isRLE(this.obj()));

  protected readonly Labels = Labels;
  protected readonly DataKeys = DataKeys;

  selectedKey = signal<string>(DataKeys.OVERVIEW);
  private manualSelection = false;
  private observer?: () => void;

  //todo get divider label from here
  elements: {
    key: string;
    label: string;
    hasDepthControl?: boolean;
    manual?: boolean;
    scope?: 'entity' | 'event';
    template?: Signal<TemplateRef<any>>;
    isPresent?: Signal<boolean>;
    disableNavigation?: Signal<boolean>;
  }[] = [
    {
      key: DataKeys.OVERVIEW,
      label: Labels.OVERVIEW,
      manual: true,
      template: this.overviewTemplate$,
      isPresent: signal(true),
    },
    {
      key: 'locationsInPWB',
      label: 'Locations',
      manual: true,
      template: this.locationsTemplate$ as Signal<TemplateRef<any>>,
      isPresent: computed(() => this.showLocations()),
    },
    {
      key: 'reactionDiagram',
      label: 'Reaction Diagram',
      manual: true,
      template: this.reactionDiagramTemplate$ as Signal<TemplateRef<any>>,
      isPresent: computed(
        () => this.isReaction() && this.showReactionDiagram()
      ),
    },
    {
      key: DataKeys.REFERENCE_ENTITY,
      label: Labels.EXTERNAL_REFERENCE,
      manual: true,
      template: this.referenceTemplate$,
    },
    { key: DataKeys.SUMMARISED_ENTITIES, label: Labels.SUMMARISED_ENTITIES },
    {
      key: DataKeys.MODIFIED_RESIDUES,
      label: Labels.MODIFIED_RESIDUES,
      manual: true,
      template: this.modificationsTemplate$,
    },

    { key: DataKeys.MEMBERS, label: Labels.MEMBERS, hasDepthControl: true },
    {
      key: DataKeys.CANDIDATES,
      label: Labels.CANDIDATES,
      hasDepthControl: true,
    },
    {
      key: DataKeys.COMPONENTS,
      label: Labels.COMPONENTS,
      hasDepthControl: true,
    },
    {
      key: DataKeys.REPEATED_UNIT,
      label: Labels.REPEATED_UNIT,
      hasDepthControl: true,
    },
    {
      key: DataKeys.PROTEIN_MARKER,
      label: Labels.MARKERS,
      manual: true,
      template: this.markerTemplate$,
      isPresent: computed(
        () => this.proteinMarkers().length + this.rnaMarkers().length > 0
      ),
    },

    {
      key: DataKeys.EVENTS,
      label: Labels.EVENTS,
      hasDepthControl: true,
      scope: 'event',
    },
    { key: DataKeys.INPUT, label: Labels.INPUTS, hasDepthControl: true },
    { key: DataKeys.OUTPUT, label: Labels.OUTPUTS, hasDepthControl: true },
    {
      key: DataKeys.REGULATED_BY,
      label: Labels.REGULATED_BY,
      manual: true,
      template: this.regulationTemplate$,
    },
    {
      key: DataKeys.CATALYST_ACTIVITIES,
      label: Labels.CATALYST_ACTIVITIES,
      manual: true,
      template: this.catalystActivitiesTemplate$,
      isPresent: computed(() => this.catalystActivities()?.length > 0),
    },

    {
      key: DataKeys.CATALYST_ACTIVITY,
      label: Labels.CATALYST_ACTIVITY,
      manual: true,
      template: this.catalystActivityTemplate$,
      isPresent: computed(() => this.catalystActivity()?.length > 0),
    },

    {
      key: DataKeys.CROSS_REFERENCE,
      label: Labels.CROSS_REFERENCES,
      manual: true,
      template: this.crossReferencesTemplate$,
      isPresent: computed(
        () => this.crossReference()?.length > 0 && !this.hasRhea()
      ),
    },
    // Rhea structure
    {
      key: camelCase(Labels.BIOCHEMICAL_REACTION),
      label: Labels.BIOCHEMICAL_REACTION,
      manual: true,
      template: this.rheaTemplate$,
      isPresent: computed(() => this.hasRhea()),
    },

    {
      key: DataKeys.PRECEDING_EVENT,
      label: Labels.PRECEDING_EVENT,
      scope: 'event',
    },
    {
      key: DataKeys.FOLLOWING_EVENT,
      label: Labels.FOLLOWING_EVENT,
      scope: 'event',
    },
    { key: DataKeys.INPUT_FOR, label: Labels.INPUT_FOR },
    { key: DataKeys.OUTPUT_FOR, label: Labels.OUTPUT_FOR },
    {
      key: DataKeys.REGULATES,
      label: Labels.REGULATES,
      manual: true,
      template: this.regulatesTemplate$,
      isPresent: computed(() => this.regulates().length > 0),
    },
    {
      key: DataKeys.COMPONENT_OF,
      label: Labels.COMPONENT_OF,
      hasDepthControl: true,
    },
    { key: DataKeys.MEMBER_OF, label: Labels.MEMBER_OF, hasDepthControl: true },
    {
      key: DataKeys.CANDIDATE_OF,
      label: Labels.CANDIDATE_OF,
      hasDepthControl: true,
    },
    {
      key: DataKeys.NORMAL_REACTION,
      label: Labels.NORMAL_REACTION,
      hasDepthControl: true,
      scope: 'event',
    },
    {
      key: DataKeys.NORMAL_PATHWAY,
      label: Labels.NORMAL_PATHWAY,
      hasDepthControl: true,
      scope: 'event',
    },
    {
      key: DataKeys.EVENT_OF,
      label: Labels.EVENT_OF,
      hasDepthControl: true,
      scope: 'event',
    },
    {
      key: DataKeys.DISEASE_PATHWAYS,
      label: Labels.DISEASE_PATHWAYS,
      hasDepthControl: true,
      scope: 'event',
    },
    {
      key: DataKeys.DISEASE_REACTIONS,
      label: Labels.DISEASE_REACTIONS,
      hasDepthControl: true,
      scope: 'event',
    },

    {
      key: DataKeys.INFERRED_TO,
      label: Labels.INFERENCES,
      manual: true,
      template: this.inferencesTemplate$,
    },
    {
      key: DataKeys.INFERRED_FROM,
      label: Labels.INFERRED_FROM,
      disableNavigation: computed(() => this.inferenceNavigationVisibility()),
    },
    {
      key: DataKeys.OTHER_FORMS,
      label: Labels.OTHER_FORMS,
      manual: true,
      template: this.otherFormsTemplate$,
      isPresent: computed(() => this.otherForms()?.size > 0),
    },

    {
      key: DataKeys.LITERATURE_REFERENCE,
      label: Labels.REFERENCE,
      manual: true,
      template: this.literatureRefsTemplate$,
    },
    {
      key: camelCase(Labels.AUTHORSHIP),
      label: Labels.AUTHORSHIP,
      manual: true,
      template: this.authorsTemplate$,
      isPresent: computed(() => this.authorship()?.length > 0),
    },
    {
      key: DataKeys.INTERACTORS,
      label: Labels.INTERACTORS,
      manual: true,
      template: this.interactorsTemplate$,
      isPresent: computed(() => this.interactorsLength() > 0),
    },
  ];

  constructor() {
    effect(() => {
      const section = this.state.section();
      if (section) {
        this.selectedKey.set(section);
      }
    });

    effect(() => {
      const ids = this.elements.map((e) => e.key);
      this.observer = observeSections(
        ids,
        this.selectedKey,
        this.manualSelection,
        false
      );
    });
  }

  ngOnDestroy(): void {
    this.observer?.();
  }

  getSymbol(obj: DatabaseObject) {
    return this.iconService.getIconDetails(obj);
  }

  // Group by species name
  getGroupedInferences(inferences: PhysicalEntity[]) {
    return this.entity.getGroupedData(inferences, (pe) => pe.speciesName);
  }

  // Group by compartment
  getGroupedOtherForms(otherForms: PhysicalEntity[]) {
    return this.entity.getGroupedData(otherForms, (pe) => {
      // Extract compartment (group name) from displayName => HSPA8 [plasma membrane] => plasma membrane
      return pe.displayName.match(/\[(.*?)\]/)?.[1] || pe.displayName;
    });
  }

  isTOCIncluded(key: string) {
    const obj = this.obj();
    switch (key) {
      case DataKeys.OVERVIEW:
        return obj;
      case 'locationsInPWB':
        return this.showLocations();
      case 'reactionDiagram':
        return this.isReaction() && this.showReactionDiagram();
      case DataKeys.PROTEIN_MARKER:
        return this.proteinMarkers().length + this.rnaMarkers().length > 0;
      case DataKeys.CATALYST_ACTIVITY:
        return this.catalystActivity() && this.catalystActivity().length > 0;
      case DataKeys.CROSS_REFERENCE:
        return this.crossReference().length > 0 && !this.hasRhea();
      case camelCase(Labels.BIOCHEMICAL_REACTION):
        return this.hasRhea();
      case DataKeys.OTHER_FORMS:
        return this.otherForms() && this.otherForms().size > 0;
      case camelCase(Labels.AUTHORSHIP):
        return this.authorship() && this.authorship().length > 0;
      case DataKeys.INTERACTORS:
        return this.interactors() && this.interactors().length > 0;
      default:
        return obj[key] !== undefined && obj[key];
    }
  }

  selectItem(key: string): void {
    this.manualSelection = true;
    this.selectedKey.set(key);
    // scroll to the section
    const el = document.getElementById(key);
    el?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'start',
    });
    // allow observer updates again after scroll completes
    setTimeout(() => {
      this.manualSelection = false;
    }, 1000);
  }

  protected readonly CONTENT_DETAIL = CONTENT_DETAIL;
  protected readonly CONTENT_DETAIL_PATH = CONTENT_DETAIL_PATH;
  protected readonly CONTENT_SCHEMA = CONTENT_SCHEMA;
  protected readonly environment = environment;
}

type OtherFormsCategory =
  | 'all'
  | 'phosphorylated'
  | 'acetylated'
  | 'methylated'
  | 'ubiquitinated'
  | 'sumoylated'
  | 'unfolded'
  | 'unmodified';

type OtherFormsDisease = 'all' | 'disease' | 'reference';

interface OtherFormsFacet<K> {
  key: K;
  label: string;
  count: number;
}

interface OtherFormsRow {
  entity: PhysicalEntity;
  compartment: string;
}

// Display order for the modification chip listbox. "all" is prepended at
// computed time. inDisease lives on its own axis -- a disease variant can
// also carry a PTM (e.g. "Ac-K120-TP53 A119Qfs*5") -- so we no longer
// short-circuit on it; the modification axis classifies purely by the
// Reactome naming convention in PhysicalEntity.name[0].
const OTHER_FORMS_CATEGORY_ORDER: [OtherFormsCategory, string][] = [
  ['phosphorylated', 'Phosphorylated'],
  ['acetylated', 'Acetylated'],
  ['methylated', 'Methylated'],
  ['ubiquitinated', 'Ubiquitinated'],
  ['sumoylated', 'SUMOylated'],
  ['unfolded', 'Unfolded'],
  ['unmodified', 'Unmodified'],
];

function categorizeOtherForm(pe: PhysicalEntity): OtherFormsCategory {
  const name = (pe.name?.[0] || pe.displayName || '').toLowerCase();
  if (/^\d?x?p-[styw]\d/.test(name)) return 'phosphorylated';
  if (name.startsWith('ac-')) return 'acetylated';
  if (/^me\d?[-k]/.test(name)) return 'methylated';
  if (/^(poly)?ub-/.test(name)) return 'ubiquitinated';
  if (/^sumo\d?-/.test(name)) return 'sumoylated';
  if (name.startsWith('unfolded ')) return 'unfolded';
  return 'unmodified';
}
