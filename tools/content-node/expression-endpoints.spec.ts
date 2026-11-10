// @vitest-environment node
//
// /ContentService/expression/{id} (spec 024, T014-T015): the heatmap of a
// selection's own genes, on the fixture cut from E-MTAB-2836's table, with a
// stand-in for the graph.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExpressionAnswer } from '../../projects/contract/expression.ts';
import { pack } from './expression-data.ts';
import type { Experiment, ExperimentFile } from './expression-data.ts';
import type { Selection } from './expression-endpoints.ts';

const read = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
vi.mock('./graph.ts', () => ({ read: (...args: unknown[]) => read(...args) }));
const { answerFor, expressionEndpoints } = await import('./expression-endpoints.ts');

const FIXTURE = readFileSync(
  new URL('./fixtures/expression-fixture.json', import.meta.url),
  'utf8'
);
const human: Experiment = {
  kind: 'experiment',
  loaded: pack(JSON.parse(FIXTURE) as ExperimentFile),
};

const protein = (
  identifier: string,
  gene: string,
  ensembl: string[],
  stId = `R-HSA-${identifier}`
) => ({
  stId,
  displayName: `UniProt:${identifier} ${gene}`,
  identifier,
  schemaClass: 'ReferenceGeneProduct',
  geneName: [gene],
  ensemblGenes: ensembl,
  species: 'Homo sapiens',
});

const APOPTOSIS: Selection = {
  species: 'Homo sapiens',
  entities: [
    protein('P10415', 'BCL2', ['ENSG00000171791']),
    protein('Q07812', 'BAX', ['ENSG00000087088']),
    protein('P55211', 'CASP9', ['ENSG00000132906']),
    protein('P04179', 'SOD2', ['ENSG00000291237']),
    protein('P01834', 'IGKC', []),
    {
      stId: 'chebi:30616',
      displayName: 'ATP(4-)',
      identifier: '30616',
      schemaClass: 'ReferenceMolecule',
      geneName: [],
      ensemblGenes: [],
      species: null,
    },
  ],
};

const heatmap = (answer: ReturnType<typeof answerFor>) => {
  if (!('kind' in answer) || answer.kind !== 'heatmap')
    throw new Error(`not a heatmap: ${JSON.stringify(answer)}`);
  return answer;
};

describe('answerFor', () => {
  it("draws a pathway's genes, says which are missing and why, and leaves chemicals out", () => {
    const answer = heatmap(answerFor(APOPTOSIS, human));
    expect(answer.rows.map((r) => r.name).sort()).toEqual(['BAX', 'BCL2', 'CASP9', 'SOD2']);
    expect(answer.notShown.map((n) => [n.identifier, n.reason])).toEqual([['P01834', 'no-gene']]);
    expect(answer.counts).toEqual({ shown: 4, genes: 5 });
    expect(answer.experiment.accession).toBe('E-MTAB-2836');
    expect(answer.experiment.tissues).toHaveLength(29);
  });

  it('writes each row exactly as the table has it', () => {
    const answer = heatmap(answerFor(APOPTOSIS, human));
    const bcl2 = answer.rows.find((r) => r.name === 'BCL2');
    const file = JSON.parse(FIXTURE) as ExperimentFile;
    expect(bcl2?.gene).toBe('ENSG00000171791');
    expect(bcl2?.values).toEqual(file.genes['ENSG00000171791']?.values);
    expect(bcl2?.from.map((f) => f.stId)).toEqual(['R-HSA-P10415']);
  });

  it("draws a complex's genes alone", () => {
    const complex: Selection = {
      species: 'Homo sapiens',
      entities: APOPTOSIS.entities.slice(0, 1),
    };
    expect(heatmap(answerFor(complex, human)).rows.map((r) => r.name)).toEqual(['BCL2']);
  });

  it('says a selection of chemicals has no genes, and names the experiment', () => {
    const atp: Selection = { species: null, entities: APOPTOSIS.entities.slice(5) };
    const answer = answerFor(atp, human);
    expect('kind' in answer && answer.kind).toBe('no-genes');
  });

  it('says a species with no listed experiment is not available', () => {
    const fly: Selection = { species: 'Drosophila melanogaster', entities: [] };
    expect(answerFor(fly, { kind: 'not-listed' })).toEqual({
      kind: 'species-not-available',
      species: 'Drosophila melanogaster',
    } satisfies ExpressionAnswer);
  });

  it("takes a reference entity's species from its proteins", () => {
    const bcl2: Selection = { species: null, entities: APOPTOSIS.entities.slice(0, 1) };
    expect(heatmap(answerFor(bcl2, human)).experiment.species).toBe('Homo sapiens');
  });
});

describe('GET /ContentService/expression/{id}', () => {
  const endpoint = expressionEndpoints[0];
  const ask = (id: string) =>
    endpoint?.handler({
      originalUrl: `/ContentService/expression/${id}`,
      protocol: 'http',
    });
  const saved = process.env['EXPRESSION_FILES'];
  afterEach(() => {
    read.mockReset();
    process.env['EXPRESSION_FILES'] = saved;
  });

  it('is 404 for an id the graph does not know', async () => {
    read.mockResolvedValue([]);
    expect((await ask('R-HSA-0'))?.status).toBe(404);
  });

  it('is 503, never another answer, when the expression data is not there', async () => {
    delete process.env['EXPRESSION_FILES'];
    read.mockResolvedValue([
      {
        species: 'Homo sapiens',
        m: { stId: 'R-HSA-P10415', identifier: 'P10415', geneName: ['BCL2'] },
        labels: ['ReferenceGeneProduct'],
        genes: ['ENSG00000171791'],
        mSpecies: 'Homo sapiens',
      },
    ]);
    const answer = await ask('R-HSA-109606');
    expect(answer?.status).toBe(503);
    expect(String(answer?.body)).toContain('Expression data is not available');
  });

  it("answers the heatmap from the graph's rows and the species' file", async () => {
    const folder = mkdtempSync(join(tmpdir(), 'expression-'));
    writeFileSync(join(folder, 'E-MTAB-2836.json'), FIXTURE);
    process.env['EXPRESSION_FILES'] = folder;
    read.mockResolvedValue([
      {
        species: 'Homo sapiens',
        m: {
          stId: 'R-HSA-P10415',
          displayName: 'UniProt:P10415 BCL2',
          identifier: 'P10415',
          geneName: ['BCL2'],
        },
        labels: ['ReferenceGeneProduct', 'ReferenceEntity'],
        genes: ['ENSG00000171791'],
        mSpecies: 'Homo sapiens',
      },
    ]);
    const answer = await ask('R-HSA-109606');
    expect(answer?.status).toBe(200);
    const body = answer?.body as ExpressionAnswer;
    expect(body.kind).toBe('heatmap');
    expect(body.kind === 'heatmap' && body.rows.map((r) => r.name)).toEqual(['BCL2']);
  });
});
