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
const backend = process.env['REACTOME_BACKEND'] || 'http://localhost:8080';

describe('the dev server proxy', () => {
  for (const list of [
    'authoredPathways',
    'authoredReactions',
    'reviewedPathways',
    'reviewedReactions',
  ]) {
    it(`sends a person's ${list} to the content service`, async () => {
      expect(await targetOf(`/ContentService/data/person/0000-0002-1825-0097/${list}`)).toBe(
        contentNode
      );
      expect(await targetOf(`/ContentService/data/person/68285/${list}?page=1`)).toBe(contentNode);
    });
  }

  for (const id of ['70486', 'R-HSA-70486.4', 'REACT_1081', 'UniProt:P04637']) {
    it(`sends the stable id of ${id} to the content service`, async () => {
      expect(await targetOf(`/ContentService/data/query/${id}/stId`)).toBe(contentNode);
    });
  }

  for (const id of ['R-HSA-5672965', '5672965', 'REACT_111102.2', 'R-HSA-70486;x']) {
    it(`sends the ancestors of ${id} to the content service`, async () => {
      expect(await targetOf(`/ContentService/data/event/${id}/ancestors`)).toBe(contentNode);
    });
  }

  for (const url of [
    '/ContentService/data/pathways/low/entity/R-HSA-199420',
    '/ContentService/data/pathways/low/entity/R-HSA-199420?species=9606',
    '/ContentService/data/pathways/low/entity/R-ALL-113592?species=Homo%20sapiens',
  ]) {
    it(`sends ${url} to the content service`, async () => {
      expect(await targetOf(url)).toBe(contentNode);
    });
  }

  it('sends the other forms of an entity to the content service', async () => {
    expect(await targetOf('/ContentService/data/entity/R-HSA-199420/otherForms')).toBe(contentNode);
  });

  it('sends the participants of an event to the content service', async () => {
    expect(await targetOf('/ContentService/data/participants/R-HSA-5672965')).toBe(contentNode);
    expect(await targetOf('/ContentService/data/participants/5672965?x=1')).toBe(contentNode);
  });

  it('sends the reference entities of an event to the content service', async () => {
    expect(
      await targetOf('/ContentService/data/participants/R-HSA-5672965/referenceEntities')
    ).toBe(contentNode);
  });

  for (const url of [
    '/ContentService/data/detail/R-HSA-199420/locationsInPWB',
    '/ContentService/data/detail/199420/locationsInPWB?directParticipants=true',
    '/ContentService/data/detail/REACT_13069/locationsInPWB?omitNonDisplayableItems=false',
  ]) {
    it(`sends ${url} to the content service`, async () => {
      expect(await targetOf(url)).toBe(contentNode);
    });
  }

  for (const url of [
    '/ContentService/data/schema/Pathway/count',
    '/ContentService/data/schema/Pathway/count?species=9606',
    '/ContentService/data/schema/DatabaseObject/count',
    '/ContentService/data/schema/Pathway/min?page=1&offset=20000',
    '/ContentService/data/schema/Pathway/min?page=2&offset=25&species=Homo%20sapiens',
    '/ContentService/data/schema/CandidateSet$AjcClosure5/min?page=1&offset=1',
  ]) {
    it(`sends ${url} to the content service`, async () => {
      expect(await targetOf(url)).toBe(contentNode);
    });
  }

  for (const other of [
    // Other attributes of the same Java endpoint are not ported.
    '/ContentService/data/query/70486/displayName',
    '/ContentService/data/query/70486/stIdVersion',
    '/ContentService/data/query/70486',
    '/ContentService/data/query/enhanced/70486',
    '/ContentService/data/person/68285',
    '/ContentService/data/person/68285/publications',
    '/ContentService/data/person/68285/authoredPathwaysAndMore',
    '/ContentService/data/database/version',
    // Only the ancestors of an event are ported.
    '/ContentService/data/event/R-HSA-5672965/ancestorsAndMore',
    '/ContentService/data/event/R-HSA-5672965/participatingPhysicalEntities',
    '/ContentService/data/eventsHierarchy/9606',
    // Only the plain lower-level pathways are ported, not every form's.
    '/ContentService/data/pathways/low/entity/R-HSA-199420/allForms',
    '/ContentService/data/pathways/low/diagram/entity/R-HSA-199420',
    // Only the participants and their reference entities are ported.
    '/ContentService/data/participants/R-HSA-5672965/participatingPhysicalEntities',
    // Only the other forms of an entity are ported.
    '/ContentService/data/entity/R-HSA-199420/in-depth',
    '/ContentService/data/entity/R-HSA-199420/componentOf',
    // Only the locations are ported, not their neighbours under /detail.
    '/ContentService/data/detail/R-HSA-199420/getReverseGraph',
    '/ContentService/data/detail/R-HSA-109581/getSubGraph',
    '/ContentService/data/detail/R-HSA-199420/locationsInPWBAndMore',
    // The event hierarchy needs the analysis service's pathway sizes.
    '/ContentService/data/eventsHierarchy/9606?pathwaysOnly=true',
    '/ContentService/data/eventsHierarchy/9606?pathwaysOnly=true&token=x',
    // Only the count and the simplified list are ported under /schema: the
    // model, attributes and referrals are reflection over graph-core's Java
    // classes, and the full objects and references are not ported.
    '/ContentService/data/schema/model',
    '/ContentService/data/schema/Pathway',
    '/ContentService/data/schema/Pathway?page=1&offset=25',
    '/ContentService/data/schema/Pathway/attributes',
    '/ContentService/data/schema/Pathway/referrals',
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
