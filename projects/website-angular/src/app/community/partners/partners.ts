interface Partner {
    name: string;
    description: string;
    url: string;
    logosrc: string;
    avalible_services: [boolean, boolean, boolean]; //Analysis Service, Widgets, Graph Database
}

export const REACTOME_PARTNERS: Partner[] = [
    {
        name: "Open Targets",
        description: "Open Targets is a public-private initiative to generate evidence on the validity of therapeutic targets based on genome-scale experiments and analysis.",
        url: "http://www.targetvalidation.org/target/ENSG00000157764",
        logosrc: "/assets/partners/openTargets_logo.png",
        avalible_services: [true, true, true]
    },
    {
        name: "The Human Protein Atlas",
        description: "Contains information for a large majority of all human protein-coding genes regarding the expression and localization of the corresponding proteins based on both RNA and protein data.",
        url: "http://www.proteinatlas.org/ENSG00000132155-RAF1/cell",
        logosrc: "/assets/partners/The_Human_Protein_Atlas.png",
        avalible_services: [true, true, true]
    },
    {
        name: "Ensembl",
        description: "Ensembl is a genome browser for vertebrate genomes that supports research in comparative genomics, evolution, sequence variation and transcriptional regulation.",
        url: "http://www.ensembl.org/Homo_sapiens/Gene/Pathway?db=core;g=ENSG00000139618;r=13:32315474-32400266",
        logosrc: "/assets/partners/ensembl.png",
        avalible_services: [true, true, true]
    },
    {
        name: "Alliance of Genome Resources",
        description: "A consortium of 7 model organism databases (MODs) and the Gene Ontology (GO) Consortium whose goal is to provide an integrated view of their data to all biologists, clinicians and other interested parties.",
        url: "https://www.alliancegenome.org/gene/HGNC:9588#pathways",
        logosrc: "/assets/partners/alliance_logo.png",
        avalible_services: [true, true, true]
    },
    {
        name: "UniProt",
        description: "UniProt has developed the Alzheimer’s disease portal to help researchers explore and access current AD genomic-based data from the UniProtKB database.",
        url: "http://disease.uniprot.org/disease/Alzheimer%20disease/protein/O00116/pathway",
        logosrc: "/assets/partners/UniProt.png",
        avalible_services: [false, true, false]
    },
    {
        name: "ChEBI",
        description: "Chemical Entities of Biological Interest (ChEBI) is a freely available dictionary of molecular entities focused on ‘small’ chemical compounds.",
        url: "http://www.ebi.ac.uk/chebi/pathway.do?chebiId=CHEBI:11230",
        logosrc: "/assets/partners/ChEBI_logo.png",
        avalible_services: [true, true, true]
    },
    {
        name: "Complex Portal",
        description: "The Complex Portal is a manually curated, encyclopaedic resource of macromolecular complexes from a number of key model organisms.",
        url: "https://www.ebi.ac.uk/complexportal/complex/EBI-9008420",
        logosrc: "/assets/partners/complexportal.png",
        avalible_services: [true, true, true]
    },
    {
        name: "PRIDE",
        description: "PRoteomics IDEntifications (PRIDE) database is a centralized, standards compliant, public data repository for proteomics data, including protein and peptide identifications, post-translational modifications and supporting spectral evidence.",
        url: "http://www.ebi.ac.uk/pride/archive/projects/PXD000764",
        logosrc: "/assets/partners/pride_logo.png",
        avalible_services: [true, true, true]
    },
    {
        name: "Tabloid Proteome",
        description: "Tabloid Proteome is a database of protein association network generated using publicly available mass spectrometry based experiments in PRIDE.",
        url: "http://iomics.ugent.be/tabloidproteome",
        logosrc: "/assets/partners/COPaKB_logo.png",
        avalible_services: [true, true, true]
    },
    {
        name: "iLINCS",
        description: "Integrative LINCS is an integrative web platform for analysis of LINCS data and signatures.",
        url: "http://www.ilincs.org/ilincs/signature/GDS_5917",
        logosrc: "/assets/partners/DCIC_500x375_cropped.png",
        avalible_services: [true, true, true]
    },
    {
        name: "Target-Pathogen",
        description: "Target-Pathogen database is a bioinformatic approach to prioritize and identify candidates drug targets for pathogens.",
        url: "http://target.sbg.qb.fcen.uba.ar/patho/protein/56425909be737e6c7a9fd658#patho_host_row",
        logosrc: "/assets/partners/targetpathogen.png",
        avalible_services: [true, true, true]
    },
    {
        name: "BioModels",
        description: "BioModels is a repository of mathematical models of biological and biomedical systems.",
        url: "https://www.ebi.ac.uk/biomodels/BIOMD0000000300",
        logosrc: "/assets/partners/BioModel_logo.png",
        avalible_services: [true, true, true]
    },
    {
        name: "PHAROS",
        description: "Pharos is the user interface to the Knowledge Management Center (KMC) for the Illuminating the Druggable Genome (IDG) program.",
        url: "https://pharos.nih.gov/targets/O94886#pathways",
        logosrc: "/assets/partners/pharos.png",
        avalible_services: [true, true, true]
    },
    {
        name: "SimpliFi",
        description: "SimpliFi is an online, browser-accessible platform that translates omics data into biological understanding.",
        url: "https://simplifi.protifi.com/#/p/97fb34a0-c963-11eb-83a8-05b21c48984a",
        logosrc: "/assets/partners/SimpliFiByProtifi.png",
        avalible_services: [true, true, true]
    },
    {
        name: "Mass Dynamics",
        description: "Mass dynamics is a commercial software product that enables proteomics workflow creation, allowing users to include custom analysis modules, such as Reactome Overrepresentation Analysis (ORA) and visualisation tools.",
        url: "https://massdynamics.com/",
        logosrc: "/assets/partners/Metabolon-FullC-Logo-Sm2x.png",
        avalible_services: [true, true, true]
    },
    {
        name: "BioBox",
        description: "BioBox is a bio-data intelligence platform for drug discovery that helps research teams understand and interpret disease biology.",
        url: "https://biobox.io/",
        logosrc: "/assets/partners/blueprint_logo.png",
        avalible_services: [true, true, true]
    },
    {
        name: "Metabolon",
        description: "Metabolon is the global leader in metabolomics, with a mission to deliver biochemical data and insights that expand and accelerate the impact of life sciences research and complement other 'omics' technologies.",
        url: "https://www.metaboloninc.com/?_gl=1*1t2z8z5*_up*MQ..&gclid=CjwKCAjwgfm3BhBeEiwAFfxrG58Pi9_EZsxjBNvohRyhhSPk92NOF6gn7jlemMhXt9eObGNogRYDrRoCbbQQAvD_BwE",
        logosrc: "/assets/partners/Metabolon-FullC-Logo-Sm2x.png",
        avalible_services: [true, true, true]
    },
    {
        name: "oloBion",
        description: "oloBion is a science-driven CRO offering advanced omics services for industry and academia. oloBion accelerates research, enhances clinical outcomes, and deepens insights into the holobiont.",
        url: "https://www.olobion.ai/",
        logosrc: "/assets/partners/oloBio.jpg",
        avalible_services: [true, true, true]
    }
];