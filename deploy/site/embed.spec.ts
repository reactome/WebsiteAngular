// @vitest-environment node
//
// Every build that makes the site also makes the embeddable diagram (spec 009,
// T043). The site serves the diagram at /embed/diagram/v1/, and the old
// widget's address with it, from the build beside its own (serve-prod.js); a
// deployment built without it answers those addresses with 404s, and the
// partners' pages lose their diagrams. `npm run build` once built the site
// alone: only beta's build made the diagram.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const scripts = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;
const steps = (name: string): string[] => (scripts[name] ?? '').split('&&').map((s) => s.trim());

describe('the embeddable diagram is in every build of the site', () => {
  it('`npm run build` builds the site and the diagram', () => {
    expect(steps('build')).toContain('npm run build:embed');
    // The rest is the site's own build, step for step, and the site's comes
    // last, so `npm run build -- --output-path <dir>` still moves the site.
    expect(steps('build').filter((step) => step !== 'npm run build:embed')).toEqual(
      steps('build:site')
    );
    expect(steps('build').at(-1)).toMatch(/^ng build( |$)/);
    expect(scripts['build:embed']).toBe('ng build reactome-diagram-element');
  });

  it("beta's build builds the diagram", () => {
    expect(steps('build:beta')).toContain('npm run build:embed -- --configuration beta');
  });

  it("the site's image builds the diagram and serves it", () => {
    const dockerfile = readFileSync(join(ROOT, 'deploy/site/Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/ng build reactome-diagram-element\b/);
    expect(dockerfile).toContain(
      'COPY --from=build /app/dist/reactome-diagram/browser ./dist/reactome-diagram/browser'
    );
  });
});
