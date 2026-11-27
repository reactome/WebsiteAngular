// @vitest-environment node
//
// Every build that makes the site also makes the embeddable diagram (spec 009,
// T043). The site serves the diagram at /embed/diagram/v1/, and the old
// widget's address with it, from the build beside its own (serve-prod.js); a
// deployment built without it answers those addresses with 404s, and the
// partners' pages lose their diagrams. `npm run build` once built the site
// alone: only beta's build made the diagram.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const scripts = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;
const steps = (name: string): string[] => (scripts[name] ?? '').split('&&').map((s) => s.trim());

const BOTH = 'scripts/build-site-and-embed.sh';
/** The two builds the script runs for these arguments, without running them. */
const builds = (...args: string[]): string[] =>
  execFileSync('bash', [join(ROOT, BOTH), ...args], {
    env: { ...process.env, BUILD_DRY_RUN: '1' },
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
/** Where each project builds to when nothing moves it: angular.json's own. */
const outputPath = (project: string): string =>
  (
    JSON.parse(readFileSync(join(ROOT, 'angular.json'), 'utf8')) as {
      projects: Record<string, { architect: { build: { options: { outputPath: string } } } }>;
    }
  ).projects[project].architect.build.options.outputPath;

describe('the embeddable diagram is in every build of the site', () => {
  it('`npm run build` builds the site and the diagram', () => {
    // The site's own build's steps, but the last, which builds both.
    expect(steps('build').slice(0, -1)).toEqual(steps('build:site').slice(0, -1));
    expect(steps('build').at(-1)).toBe(`${BOTH} production production`);
    expect(builds('production', 'production')).toEqual([
      'npx ng build reactome --configuration production',
      'npx ng build reactome-diagram-element --configuration production',
    ]);
    expect(scripts['build:embed']).toBe('ng build reactome-diagram-element');
  });

  it("beta's build builds the diagram", () => {
    expect(steps('build:beta').slice(0, -1)).toEqual(steps('build:site').slice(0, -1));
    expect(steps('build:beta').at(-1)).toBe(`${BOTH} production,beta beta`);
  });

  // npm appends `npm run build -- <args>` to the script's last command alone.
  // While that was one of the two builds, `--output-path <dir>` moved the site
  // and the diagram still built into dist/reactome-diagram, which a deployment
  // serving from the tree publishes, emptied first.
  it('an output path moves both builds, laid out as dist/ is', () => {
    const site = basename(outputPath('reactome'));
    const diagram = basename(outputPath('reactome-diagram-element'));
    expect([site, diagram]).toEqual(['reactome', 'reactome-diagram']);
    for (const args of [['--output-path', '/scratch/out'], ['--output-path=/scratch/out/']])
      expect(builds('production', 'production', ...args)).toEqual([
        `npx ng build reactome --configuration production --output-path /scratch/out/${site}`,
        `npx ng build reactome-diagram-element --configuration production --output-path /scratch/out/${diagram}`,
      ]);
  });

  it('refuses any other argument, rather than give it to one build', () => {
    for (const args of [
      ['production', 'production', '--configuration', 'development'],
      ['production', 'production', '--watch'],
      ['production', 'production', '--output-path'],
      ['production', 'production', '--output-path', '/a', '--output-path', '/b'],
      ['production'],
      ['production', '--output-path', '/a'],
    ]) {
      const run = spawnSync('bash', [join(ROOT, BOTH), ...args], {
        env: { ...process.env, BUILD_DRY_RUN: '1' },
        encoding: 'utf8',
      });
      expect(run.status, args.join(' ')).toBe(2);
      expect(run.stdout, args.join(' ')).toBe('');
    }
  });

  it("the site's image builds the diagram and serves it", () => {
    const dockerfile = readFileSync(join(ROOT, 'deploy/site/Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/ng build reactome-diagram-element\b/);
    expect(dockerfile).toContain(
      'COPY --from=build /app/dist/reactome-diagram/browser ./dist/reactome-diagram/browser'
    );
  });
});
