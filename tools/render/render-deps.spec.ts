import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The render service ships as its own container and so declares its own
 * dependencies, rather than installing the site's entire tree to run four
 * packages. Two manifests means they can drift, and a drift shows up as a
 * container that behaves differently from the CLI everything was tested with --
 * a mismatched Playwright being the obvious one, since the browser it downloads
 * is version-locked to the library.
 */
describe('render service dependencies', () => {
  const read = (file: string) =>
    JSON.parse(readFileSync(path.resolve(__dirname, file), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

  it('pins the same versions as the root package.json', () => {
    const root = read('../../package.json');
    const service = read('./package.json');
    const rootVersion = (name: string) => root.dependencies?.[name] ?? root.devDependencies?.[name];

    for (const [name, version] of Object.entries(service.dependencies ?? {})) {
      expect(rootVersion(name), `${name} is not a dependency of the root package`).toBeDefined();
      expect(version, `${name} differs between the render service and the root`).toBe(
        rootVersion(name)
      );
    }
  });
});
