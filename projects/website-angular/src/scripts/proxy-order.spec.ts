import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

// Which backend `ng serve` sends a request to. The dev server does not use
// proxy.conf.js as written: Angular's loader rewrites every glob key into a
// regex and re-inserts it at the end of the table, and Vite then takes the
// first key that matches. A specific entry written above a general one can
// still lose to it (#318). So the table is read through Angular's own loader,
// and matched by Vite's rule, rather than read off the file.

type Entry = { target?: string };

const root = process.cwd();
// By file: the package does not export its loader, and this is the code that
// decides what `ng serve` does.
const load = createRequire(path.join(root, 'package.json'))(
  path.join(root, 'node_modules/@angular/build/src/utils/load-proxy-config.js')
) as {
  loadProxyConfiguration(root: string, file: string): Promise<Record<string, Entry>>;
};

/** Vite's doesProxyContextMatchUrl: a `^` key is a regex, anything else a prefix. */
const matches = (context: string, url: string) =>
  (context.startsWith('^') && new RegExp(context).test(url)) || url.startsWith(context);

async function targetOf(url: string) {
  const table = await load.loadProxyConfiguration(root, 'proxy.conf.js');
  const context = Object.keys(table).find((key) => matches(key, url));
  return context && table[context]?.target;
}

const contentNode = process.env['CONTENT_NODE_TARGET'] || 'http://127.0.0.1:4400';

/**
 * That a URL goes to the content service -- and with a trailing slash too,
 * which Spring matches on every endpoint, so it must reach node once Java is
 * switched off.
 */
async function expectContentNode(url: string) {
  const [path, query] = url.split(/(?=\?)/);
  const slashed = path.endsWith('/') ? url : `${path}/${query ?? ''}`;
  expect([url, await targetOf(url)]).toEqual([url, contentNode]);
  expect([slashed, await targetOf(slashed)]).toEqual([slashed, contentNode]);
}
const backend = process.env['REACTOME_BACKEND'] || 'http://localhost:8080';

describe('the dev server proxy', () => {
  for (const list of [
    'authoredPathways',
    'authoredReactions',
    'reviewedPathways',
    'reviewedReactions',
  ]) {
    it(`sends a person's ${list} to the content service`, async () => {
      await expectContentNode(`/ContentService/data/person/0000-0002-1825-0097/${list}`);
      await expectContentNode(`/ContentService/data/person/68285/${list}?page=1`);
    });
  }

  for (const id of ['70486', 'R-HSA-70486.4', 'REACT_1081', 'UniProt:P04637']) {
    it(`sends the stable id of ${id} to the content service`, async () => {
      await expectContentNode(`/ContentService/data/query/${id}/stId`);
    });
  }

  for (const id of ['R-HSA-5672965', '5672965', 'REACT_111102.2', 'R-HSA-70486;x']) {
    it(`sends the ancestors of ${id} to the content service`, async () => {
      await expectContentNode(`/ContentService/data/event/${id}/ancestors`);
    });
  }

  for (const url of [
    '/ContentService/data/pathways/low/entity/R-HSA-199420',
    '/ContentService/data/pathways/low/entity/R-HSA-199420?species=9606',
    '/ContentService/data/pathways/low/entity/R-ALL-113592?species=Homo%20sapiens',
  ]) {
    it(`sends ${url} to the content service`, async () => {
      await expectContentNode(url);
    });
  }

  for (const url of [
    '/ContentService/data/query/enhanced/v2/R-HSA-70486',
    '/ContentService/data/query/enhanced/v2/uniprot:P01112?summariseReferenceEntity=true&includeRef=true',
    '/ContentService/data/query/enhanced/R-HSA-70486',
    '/ContentService/data/query/enhanced/70486?includeRef=true',
    // Java's /query/enhanced/{id} with the id `normalPathway`, not
    // /query/{id}/normalPathway with the id `enhanced`.
    '/ContentService/data/query/enhanced/normalPathway',
  ]) {
    it(`sends ${url} to the content service`, async () => {
      await expectContentNode(url);
    });
  }

  for (const url of [
    '/ContentService/data/entity/R-HSA-109796/in-depth',
    '/ContentService/data/entity/109796/in-depth?includeRef=true&view=nested-aggregated',
    '/ContentService/data/event/R-HSA-69620/in-depth?maxDepth=2',
  ]) {
    it(`sends ${url} to the content service`, async () => {
      await expectContentNode(url);
    });
  }

  for (const url of [
    '/ContentService/data/person/68285',
    '/ContentService/data/person/0000-0002-3218-5631?view=nested',
    '/ContentService/data/person/68285/publications',
  ]) {
    it(`sends ${url} to the content service`, async () => {
      await expectContentNode(url);
    });
  }

  for (const url of [
    '/ContentService/data/query/R-HSA-70486',
    '/ContentService/data/query/70486?view=nested-aggregated',
    '/ContentService/data/query/R-HSA-70486?includeRef=true',
  ]) {
    it(`sends ${url} to the content service`, async () => {
      await expectContentNode(url);
    });
  }

  for (const url of [
    '/ContentService/data/query/R-HSA-6802957/normalPathway',
    '/ContentService/data/query/6802957/normalPathway?x=1',
  ]) {
    it(`sends ${url} to the content service`, async () => {
      await expectContentNode(url);
    });
  }

  it('sends the other forms of an entity to the content service', async () => {
    await expectContentNode('/ContentService/data/entity/R-HSA-199420/otherForms');
  });

  for (const url of [
    '/ContentService/data/database/version',
    '/ContentService/data/database/name',
    '/ContentService/data/pathways/top/9606',
    '/ContentService/data/pathways/top/Homo+sapiens',
  ]) {
    it(`sends ${url} to the content service`, async () => {
      await expectContentNode(url);
    });
  }

  it('sends the participants of an event to the content service', async () => {
    await expectContentNode('/ContentService/data/participants/R-HSA-5672965');
    await expectContentNode('/ContentService/data/participants/5672965?x=1');
  });

  it('sends the reference entities of an event to the content service', async () => {
    await expectContentNode('/ContentService/data/participants/R-HSA-5672965/referenceEntities');
  });

  for (const url of [
    '/ContentService/data/detail/R-HSA-199420/locationsInPWB',
    '/ContentService/data/detail/199420/locationsInPWB?directParticipants=true',
    '/ContentService/data/detail/REACT_13069/locationsInPWB?omitNonDisplayableItems=false',
  ]) {
    it(`sends ${url} to the content service`, async () => {
      await expectContentNode(url);
    });
  }

  for (const url of [
    '/ContentService/data/schema/Pathway/count',
    '/ContentService/data/schema/Pathway/count?species=9606',
    '/ContentService/data/schema/DatabaseObject/count',
    '/ContentService/data/schema/Pathway/min?page=1&offset=20000',
    '/ContentService/data/schema/Pathway/min?page=2&offset=25&species=Homo%20sapiens',
    '/ContentService/data/schema/CandidateSet$AjcClosure5/min?page=1&offset=1',
    '/ContentService/data/schema/model',
    '/ContentService/data/schema/model?x=1',
    '/ContentService/data/schema/Pathway/attributes',
    '/ContentService/data/schema/Pathway/referrals',
    '/ContentService/data/schema/Trackable/referrals?x=1',
    '/ContentService/data/schema/Pathway$AjcClosure5/attributes',
    // Not a class, which node answers with Java's 500, as Java does.
    '/ContentService/data/schema/model/attributes',
  ]) {
    it(`sends ${url} to the content service`, async () => {
      await expectContentNode(url);
    });
  }

  for (const url of [
    '/ContentService/data/orthology/R-HSA-69620/species/48892',
    '/ContentService/data/orthology/69620/species/0xBEFC?view=nested',
    // The POST the species selector sends.
    '/ContentService/data/orthologies/ids/species/48892',
  ]) {
    it(`sends ${url} to the content service`, async () => {
      await expectContentNode(url);
    });
  }

  for (const url of [
    '/ContentService/interactors/static/molecule/P04637/details',
    '/ContentService/interactors/static/molecule/P04637/details?page=1&pageSize=3',
    '/ContentService/interactors/static/molecule/enhanced/Q9BXM7-1/details',
    '/ContentService/interactors/static/molecule/P04637/withEntities',
    // The diagram's POST, for every protein in it.
    '/ContentService/interactors/static/molecules/details',
  ]) {
    it(`sends ${url} to the content service`, async () => {
      await expectContentNode(url);
    });
  }

  for (const url of [
    '/ContentService/search/suggest?query=apop',
    '/ContentService/search/spellcheck?query=apoptosys',
    '/ContentService/search/suggest',
    '/ContentService/search/facet',
    '/ContentService/search/icon/facet',
    '/ContentService/search/facet_query?query=TP53&species=Homo%20sapiens',
    '/ContentService/search/icon/query?query=x',
    '/ContentService/search/icon/R-ICO-013428',
    '/ContentService/search/diagram/R-HSA-8848021?query=MAD',
    '/ContentService/search/diagram/R-HSA-68886/occurrences/R-HSA-141433',
    '/ContentService/search/diagram/summary?query=KIF&diagram=R-HSA-8848021',
    '/ContentService/search/diagram/R-HSA-446203/flag?query=CTSA',
    '/ContentService/search/fireworks/flag?query=KNTC1&species=Mus%20musculus',
    '/ContentService/search/pathways/of/227785?fields=ST_ID&directlyInDiagram=true',
    '/ContentService/search/fireworks?query=KNTC1',
    '/ContentService/search/fireworks/?query=MAD2&species=Homo%20sapiens',
    '/ContentService/search/query?query=TP53&cluster=true&Start%20row=0&rows=30',
    '/ContentService/search/query/paginated?query=TP53&page=1&rowCount=20',
    '/ContentService/citation/pathway/R-HSA-109581?dateAccessed=x',
    '/ContentService/citation/static/25348405',
    '/ContentService/citation/export?id=R-HSA-109581&ext=bib&isPathway=true&dateAccessed=x',
    '/ContentService/data/instance/R-HSA-141433/referrers',
    // The PSICQUIC services the Pathway Browser can draw interactors from.
    '/ContentService/interactors/psicquic/resources',
    // Spring matches a trailing slash, and so must the route once Java is gone.
    '/ContentService/data/instance/R-HSA-141433/referrers/',
  ]) {
    it(`sends ${url} to the content service`, async () => {
      await expectContentNode(url);
    });
  }

  for (const other of [
    // Other attributes of the same Java endpoint are not ported.
    '/ContentService/data/query/70486/displayName',
    '/ContentService/data/query/70486/stIdVersion',
    '/ContentService/data/query/70486/normalPathways',
    // Java's more specific /query/abridged/{id} takes this, reading the
    // attribute's name as the id. (/query/enhanced/{id} does the same, and
    // is node's now: see above.)
    '/ContentService/data/query/abridged/stId',
    // Java matches attribute names in any case; only the site's spelling is routed.
    '/ContentService/data/query/70486/NORMALPATHWAY',
    // Java's POST /query/ids (a batch of objects), which node does not serve.
    '/ContentService/data/query/ids',
    '/ContentService/data/query/ids/',
    // With a matrix parameter, which Spring drops before matching.
    '/ContentService/data/query/ids;x=1',
    '/ContentService/data/query/abridged/70486',
    // The search endpoints node does not serve yet.
    '/ContentService/search/query/x?query=apoptosis',
    '/ContentService/search/suggestions?query=apop',
    '/ContentService/search/suggest/x',
    '/ContentService/search/facet_query/x?query=TP53',
    '/ContentService/search/icon/R-ICO-013428/x',
    '/ContentService/search/fireworks/flag/x?query=KNTC1',
    '/ContentService/search/fireworks/x?query=KNTC1',
    '/ContentService/search/pathways/of/227785/x',
    '/ContentService/citation/export/R-HSA-109581?ext=bib',
    '/ContentService/citation/download',
    '/ContentService/data/instance/R-HSA-141433',
    '/ContentService/data/instance/R-HSA-141433/referrers/x',
    '/ContentService/search/diagram/R-HSA-68886/occurrences',
    // The interactor endpoints node does not serve.
    '/ContentService/interactors/static/molecule/P04637/summary',
    '/ContentService/interactors/static/molecules/summary',
    '/ContentService/interactors/static/molecule/P04637/pathways',
    '/ContentService/interactors/psicquic/molecules/IntAct/details',
    '/ContentService/interactors/psicquic/resources/x',
    '/ContentService/interactors/psicquic/molecule/MINT/P04637/details',
    '/ContentService/interactors/upload/tuple/content',
    '/ContentService/interactors/static/molecule/P04637/details.pdf',
    // Spring's own 404s: no species, or more after it.
    '/ContentService/data/orthology/R-HSA-69620/species/',
    '/ContentService/data/orthologies/ids/species/48892/x',
    '/ContentService/data/person/68285/authoredPathwaysAndMore',
    // Only the ancestors of an event are ported.
    '/ContentService/data/event/R-HSA-5672965/ancestorsAndMore',
    '/ContentService/data/event/R-HSA-5672965/participatingPhysicalEntities',
    '/ContentService/data/eventsHierarchy/9606',
    // Only the plain lower-level pathways are ported, not every form's.
    '/ContentService/data/pathways/low/entity/R-HSA-199420/allForms',
    '/ContentService/data/pathways/low/diagram/entity/R-HSA-199420',
    // The curated top-level pathways and the database's other info are not.
    '/ContentService/data/pathways/top/9606/curated',
    '/ContentService/data/database/info',
    // Only the participants and their reference entities are ported.
    '/ContentService/data/participants/R-HSA-5672965/participatingPhysicalEntities',
    // Only the other forms and in-depth of an entity are ported.
    '/ContentService/data/entity/R-HSA-199420/componentOf',
    // Only the locations are ported, not their neighbours under /detail.
    '/ContentService/data/detail/R-HSA-199420/getReverseGraph',
    '/ContentService/data/detail/R-HSA-109581/getSubGraph',
    '/ContentService/data/detail/R-HSA-199420/locationsInPWBAndMore',
    // The event hierarchy needs the analysis service's pathway sizes.
    '/ContentService/data/eventsHierarchy/9606?pathwaysOnly=true',
    '/ContentService/data/eventsHierarchy/9606?pathwaysOnly=true&token=x',
    // Under /schema, the full objects and references are not ported; only the
    // model, the count, the simplified list, attributes and referrals are.
    '/ContentService/data/schema/Pathway',
    '/ContentService/data/schema/Pathway?page=1&offset=25',
    '/ContentService/data/schema/models',
    '/ContentService/data/schema/Pathway/attributesAll',
    '/ContentService/data/schema/Pathway/referrals/x',
    '/ContentService/data/schema/ReferenceMolecule/reference?page=1&offset=10',
    '/ContentService/data/schema/Pathway/countAll',
    '/ContentService/data/schema/Pathway/minimal?page=1&offset=1',
    '/ContentService/data/schema/Pathway/count/x',
  ]) {
    it(`leaves ${other} with Java`, async () => {
      expect(await targetOf(other)).toBe(backend);
    });
  }
});
