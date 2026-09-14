// ── Interfaces ──────────────────────────────────────────────────────────────

export interface TocItem {
  id: string;
  label: string;
}

export interface ServiceCard {
  icon: string;
  title: string;
  description: string;
  url: string;
  external: boolean;
}

export interface DatabaseDownload {
  label: string;
  file: string;
  description?: string;
  url?: string; // full URL override (e.g. ECR)
}

export interface MappingDatabase {
  name: string;
  prefix: string; // e.g. 'UniProt', 'ChEBI'
}

export interface MappingCategory {
  label: string;
  suffix: string; // appended to prefix, e.g. '2Reactome_PE_Pathway.tsv'
  info?: string;
}

export interface OtherMapping {
  label: string;
  file: string;
  infoKey?: string; // key into INFO_PANELS
}

export interface DownloadItem {
  label: string;
  file: string;
  description?: string;
}

// ── URL Builders ────────────────────────────────────────────────────────────

export function buildUrl(base: string, version: string, path: string): string {
  return `${base}/${version}/${path}`;
}

export function buildMappingUrl(base: string, version: string, db: string, suffix: string): string {
  return `${base}/${version}/${db}${suffix}`;
}

// ── Table of Contents ───────────────────────────────────────────────────────

export const TOC_ITEMS: TocItem[] = [
  { id: 'services', label: 'Services & Repositories' },
  { id: 'databases', label: 'Databases' },
  { id: 'identifier-mapping', label: 'Identifier Mapping Files' },
  { id: 'pe-mapping', label: 'PE Identifier Mapping Files' },
  { id: 'other-mappings', label: 'Other Mapping Files' },
  { id: 'pathway-info', label: 'Pathway Information' },
  { id: 'diagrams', label: 'Pathway Diagrams & Figures' },
  { id: 'gene-ontology', label: 'Gene Ontology' },
  { id: 'systems-biology', label: 'Systems Biology' },
  { id: 'gene-set', label: 'Gene Set' },
  { id: 'ontology', label: 'Ontology' },
  { id: 'ppi', label: 'Protein-Protein Interactions' },
  { id: 'functional-interactions', label: 'Functional Interactions' },
  { id: 'curator-tool', label: 'Curator Tool' },
  { id: 'textbook', label: 'Textbook' },
];

// ── Service Cards ───────────────────────────────────────────────────────────

export const SERVICE_CARDS: ServiceCard[] = [
  {
    icon: 'api',
    title: 'Content Service',
    description: 'Direct API access to Reactome pathway data in multiple formats.',
    url: '/ContentService',
    external: false,
  },
  {
    icon: 'analytics',
    title: 'Analysis Service',
    description: 'Pathway analysis via API for integration with third-party tools.',
    url: '/AnalysisService',
    external: false,
  },
  {
    icon: 'cloud_upload',
    title: 'Zenodo Repository',
    description: 'Quarterly release archives starting from v89 (June 2024).',
    url: 'https://zenodo.org/communities/reactome',
    external: true,
  },
  {
    icon: 'code',
    title: 'GitHub Repository',
    description: 'Open-source code for Reactome tools and services.',
    url: 'https://github.com/reactome',
    external: true,
  },
];

// ── Database Downloads ──────────────────────────────────────────────────────

export const GRAPH_DB_DOWNLOADS: DatabaseDownload[] = [
  {
    label: 'Graph Database',
    file: 'reactome.graphdb.tgz',
    description: 'Neo4j graph database archive (.tgz)',
  },
  {
    label: 'Graph Database Dump',
    file: 'reactome.graphdb.dump',
    description: 'Neo4j dump file (.dump)',
  },
  {
    label: 'ECR Container',
    file: '',
    url: 'https://gallery.ecr.aws/reactome/graphdb',
    description: 'AWS Elastic Container Registry image',
  },
];

export const MYSQL_DOWNLOADS: DatabaseDownload[] = [
  {
    label: 'Main Database',
    file: 'databases/gk_current.sql.gz',
    description: 'Reactome relational database (gk_current.sql.gz)',
  },
  {
    label: 'Stable Identifiers',
    file: 'databases/gk_stable_ids.sql.gz',
    description: 'Stable identifiers database (gk_stable_ids.sql.gz)',
  },
];

// ── Mapping Databases ───────────────────────────────────────────────────────

export const MAPPING_DATABASES: MappingDatabase[] = [
  { name: 'UniProt', prefix: 'UniProt' },
  { name: 'ChEBI', prefix: 'ChEBI' },
  { name: 'ENSEMBL', prefix: 'Ensembl' },
  { name: 'miRBase', prefix: 'miRBase' },
  { name: 'NCBI', prefix: 'NCBI' },
  { name: 'GtoP', prefix: 'GtoP' },
];

export const MAPPING_CATEGORIES: MappingCategory[] = [
  {
    label: 'Lowest Level Pathway',
    suffix: '2Reactome.txt',
    info: 'Mapping of identifiers to the lowest level Reactome pathway diagrams/subsets in which they are found.',
  },
  {
    label: 'All Levels',
    suffix: '2Reactome_All_Levels.txt',
    info: 'Mapping of identifiers to all levels of the Reactome pathway hierarchy in which they are found.',
  },
  {
    label: 'All Reactions',
    suffix: '2ReactomeReactions.txt',
    info: 'Mapping of identifiers to all Reactome reactions in which they participate.',
  },
];

export const PE_MAPPING_CATEGORIES: MappingCategory[] = [
  {
    label: 'PE to Lowest Level Pathway',
    suffix: '2Reactome_PE_Pathway.txt',
    info: 'Mapping of Physical Entity (PE) identifiers to the lowest level Reactome pathway diagrams/subsets.',
  },
  {
    label: 'PE to All Levels',
    suffix: '2Reactome_PE_All_Levels.txt',
    info: 'Mapping of Physical Entity (PE) identifiers to all levels of the Reactome pathway hierarchy.',
  },
  {
    label: 'PE to All Reactions',
    suffix: '2Reactome_PE_Reactions.txt',
    info: 'Mapping of Physical Entity (PE) identifiers to all Reactome reactions.',
  },
];

// ── Other Mapping Files ─────────────────────────────────────────────────────

export const OTHER_MAPPINGS: OtherMapping[] = [
  {
    label: 'BioModels to Reactome Pathways',
    file: 'models2pathways.tsv',
    infoKey: 'biomodels',
  },
  {
    label: 'Reaction PMIDs',
    file: 'ReactionPMIDS.txt',
    infoKey: 'reactionPmids',
  },
  {
    label: 'Reactome to OMIM',
    file: 'Reactome2OMIM.txt',
    infoKey: 'omim',
  },
  {
    label: 'Protein Role Reaction',
    file: 'ProteinRoleReaction.txt',
    infoKey: 'proteinRole',
  },
  {
    label: 'Disease Variant EWAS Mapping',
    file: 'disease_variant_ewas_mapping.tsv',
    infoKey: 'diseaseVariant',
  },
  {
    label: 'Human Pathways with Entity-level Diagrams',
    file: 'humanPathwaysWithDiagrams.txt',
    infoKey: 'entityDiagrams',
  },
  // Published alongside the rest and listed on the current site, but missing
  // from this page until now.
  {
    label: 'Complex to Pathway (human)',
    file: 'Complex_2_Pathway_human.txt',
  },
  {
    label: 'EWAS to Pathway (human)',
    file: 'Ewas2Pathway_human.txt',
  },
];

// ── Pathway Information Downloads ───────────────────────────────────────────

export const PATHWAY_DOWNLOADS: DownloadItem[] = [
  {
    label: 'Complete List of Pathways',
    file: 'ReactomePathways.txt',
    description: 'Tab-delimited file of all Reactome pathways with stable IDs, names, and species.',
  },
  {
    label: 'Pathway Hierarchy Relationships',
    file: 'ReactomePathwaysRelation.txt',
    description: 'Parent-child relationships between Reactome pathways.',
  },
  {
    label: 'Complexes to Pathways (Human)',
    file: 'ComplexParticipantsPubMedIdentifiers_human.txt',
    description: 'Human complexes with participant details and PubMed identifiers.',
  },
  {
    label: 'EWAS to Pathways (Human)',
    file: 'Ensembl2Reactome_PE_Pathway.txt',
    description: 'Entity with Accession Sequence (EWAS) to pathway mapping for Homo sapiens.',
  },
];

// ── Diagram Downloads ───────────────────────────────────────────────────────

export const DIAGRAM_DOWNLOADS: DownloadItem[] = [
  {
    label: 'Human Pathway Diagrams (SVG)',
    file: 'diagrams.svg.tgz',
    description: 'SVG format pathway diagrams for Homo sapiens.',
  },
  {
    label: 'Human Pathway Diagrams (PNG)',
    file: 'diagrams.png.tgz',
    description: 'PNG format pathway diagrams for Homo sapiens.',
  },
];

// ── Gene Ontology Downloads ─────────────────────────────────────────────────

export const GENE_ONTOLOGY_DOWNLOADS: DownloadItem[] = [
  {
    label: 'Gene Association File',
    file: 'gene_association.reactome.gz',
    description: 'GO annotations for Reactome proteins (compressed .gz).',
  },
  {
    label: 'Pathways to GO Terms',
    file: 'Pathways2GoTerms_human.txt',
    description: 'Mapping of Reactome pathways to Gene Ontology terms.',
  },
  {
    label: 'Reactions to GO Terms',
    file: 'Reactions2GoTerms_human.txt',
    description: 'Mapping of Reactome reactions to Gene Ontology terms.',
  },
];

// ── Systems Biology Downloads ───────────────────────────────────────────────

export const SYSTEMS_BIOLOGY_DOWNLOADS: DownloadItem[] = [
  {
    label: 'SBML (Human)',
    file: 'homo_sapiens.3.1.sbml.tgz',
    description: 'SBML Level 3 Version 1 — human reactions.',
  },
  {
    label: 'SBML (All Species)',
    file: 'all_species.3.1.sbml.tgz',
    description: 'SBML Level 3 Version 1 — all species reactions.',
  },
  {
    label: 'BioPAX Level 3',
    file: 'biopax.zip',
    description: 'BioPAX Level 3 export of all Reactome events.',
  },
  {
    label: 'SBGN (Human)',
    file: 'homo_sapiens.sbgn.tar.gz',
    description: 'SBGN process diagrams for human pathways.',
  },
];

// ── Gene Set ────────────────────────────────────────────────────────────────

export const GENE_SET_DOWNLOADS: DownloadItem[] = [
  {
    label: 'Reactome Pathways Gene Set',
    file: 'ReactomePathways.gmt.zip',
    description: 'GMT format gene set file for use with GSEA and other enrichment tools.',
  },
];

// ── Ontology ────────────────────────────────────────────────────────────────

export const ONTOLOGY_DOWNLOADS: DownloadItem[] = [
  {
    label: 'Reactome Stable Identifiers',
    file: 'reactome_stable_ids.txt',
    description: 'Complete list of Reactome stable identifiers.',
  },
];

// ── PPI Downloads ───────────────────────────────────────────────────────────

export const PPI_MITAB_DOWNLOADS: DownloadItem[] = [
  {
    label: 'All Species (PSI-MITAB)',
    file: 'interactors/reactome.all_species.interactions.psi-mitab.txt',
    description: 'Protein-protein interactions for all species in PSI-MITAB format.',
  },
  {
    label: 'Human Only (PSI-MITAB)',
    file: 'interactors/reactome.homo_sapiens.interactions.psi-mitab.txt',
    description: 'Protein-protein interactions for Homo sapiens in PSI-MITAB format.',
  },
];

export const PPI_TAB_DOWNLOADS: DownloadItem[] = [
  {
    label: 'All Species (Tab-delimited)',
    file: 'interactors/reactome.all_species.interactions.tab-delimited.txt',
    description: 'Protein-protein interactions for all species in tab-delimited format.',
  },
  {
    label: 'Human Only (Tab-delimited)',
    file: 'interactors/reactome.homo_sapiens.interactions.tab-delimited.txt',
    description: 'Protein-protein interactions for Homo sapiens in tab-delimited format.',
  },
];

// ── Functional Interactions ─────────────────────────────────────────────────

export interface ToolDownload {
  label: string;
  url: string;
  description: string;
}

/**
 * The functional-interaction networks.
 *
 * Not release artefacts: they are published under reactome.org/download/tools
 * rather than in the versioned download bucket, and their file names carry the
 * build date rather than the year in the label. Every one of these used to be
 * built as `<bucket>/current/FIsInGene_...`, a path that does not exist -- so
 * the whole section 403'd. Names taken from the published set and checked.
 */
const FI_BASE = 'https://reactome.org/download/tools/ReactomeFIs';

export const FUNCTIONAL_INTERACTIONS: ToolDownload[] = [
  {
    label: 'FI Network 2025',
    url: `${FI_BASE}/FIsInGene_04142025_with_annotations.txt.zip`,
    description: 'Functional interaction network (2025 version) with annotations.',
  },
  {
    label: 'FI Network 2024',
    url: `${FI_BASE}/FIsInGene_061424_with_annotations.txt.zip`,
    description: 'Functional interaction network (2024 version, KEGG data removed).',
  },
  {
    label: 'FI Network 2022',
    url: `${FI_BASE}/FIsInGene_070323_with_annotations.txt.zip`,
    description: 'Functional interaction network (2022 version, random forest classifier).',
  },
  {
    label: 'FI Network 2021',
    url: `${FI_BASE}/FIsInGene_122921_with_annotations.txt.zip`,
    description: 'Functional interaction network (2021 version).',
  },
  {
    label: 'FI Network 2020',
    url: `${FI_BASE}/FIsInGene_122220_with_annotations.txt.zip`,
    description: 'Functional interaction network (2020 version).',
  },
];

// ── Curator Tool ────────────────────────────────────────────────────────────

export const CURATOR_TOOL = {
  label: 'Curator Tool',
  version: 'v4.0.4, build 119',
  date: 'November 2025',
  description: 'Desktop application for internal Reactome pathway annotation.',
  // Installers, not a bare jar: what the current site actually distributes.
  installers: [
    {
      label: 'Windows / Linux',
      url: 'https://reactome.org/download/tools/curatorTool/InstData/win_linux/install.zip',
    },
    {
      label: 'macOS',
      url: 'https://reactome.org/download/tools/curatorTool/InstData/mac/install.zip',
    },
  ],
};

// ── Textbook ────────────────────────────────────────────────────────────────

export const TEXTBOOK = {
  label: 'The Reactome Book',
  file: 'TheReactomeBook.pdf.tgz',
  description: 'Comprehensive documentation of Reactome pathways (PDF).',
};

// ── Info Panels ─────────────────────────────────────────────────────────────

export const INFO_PANELS: Record<string, string> = {
  identifierMapping:
    'These files map external database identifiers (UniProt, ChEBI, ENSEMBL, miRBase, NCBI, GtoP) to Reactome pathways and reactions. Three mapping levels are provided: lowest level pathways only, all hierarchy levels, and all reactions.',
  peMapping:
    'Physical Entity (PE) mapping files link identifiers to Reactome using Physical Entity stable IDs rather than pathway-level mappings. These are useful when you need to reference specific molecular instances within pathways.',
  biomodels:
    'Mapping of BioModels database entries to Reactome pathways. Each line contains a BioModels ID and the corresponding Reactome pathway stable identifier.',
  reactionPmids:
    'Lists all Reactome reactions along with associated PubMed identifiers (PMIDs) that serve as evidence references for each reaction.',
  omim: 'Mapping of Reactome pathways and reactions to OMIM (Online Mendelian Inheritance in Man) disease identifiers.',
  proteinRole:
    'Details the role (input, output, catalyst, regulator) of each protein in Reactome reactions, useful for network analysis.',
  diseaseVariant:
    'Mapping file listing disease-associated variant Entity With Accession Sequences (EWAS) in Reactome, linking genomic variants to affected pathways.',
  entityDiagrams:
    'List of human pathways that have entity-level diagrams, showing individual molecules and their interactions within the pathway.',
  graphDb:
    'The Reactome Knowledge Graph is a Neo4j graph database containing all Reactome data in a highly connected, queryable format. Use the .tgz archive for manual setup or the .dump file for Neo4j Admin import. An AWS ECR container image is also available.',
};
