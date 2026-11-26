// @vitest-environment node
//
// The CI workflows' two safety rules, checked on every one of them.
//
// 1. No `${{ }}` expression a pull request controls inside a `run:` script.
//    The expression is pasted into the script before the shell sees it, so a
//    branch named `x$(curl …|sh)` ran in guardrail.yml (review, 16 Oct 2026).
//    Such values go through `env:` and are read as "$VARIABLE".
// 2. A `permissions:` block, so no job runs with the default token's scope.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('.github/workflows');
const workflows = readdirSync(DIR).filter((name) => /\.ya?ml$/.test(name));
// Whatever a pull request, a dispatcher or an event names: branch and ref
// names, event payloads, dispatch inputs. Matched inside each `${{ … }}`
// whole -- an expression may contain braces itself, format('{0}', …).
const UNTRUSTED = /github\.(head_ref|ref_name|base_ref|event\.)|\binputs\./;
const pastes = (line: string) =>
  [...line.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].some(([, inner = '']) => UNTRUSTED.test(inner));

/** The lines of every `run:` script, with their line numbers. */
function scriptLines(text: string): [number, string][] {
  const lines = text.split('\n');
  const found: [number, string][] = [];
  for (let at = 0; at < lines.length; at += 1) {
    // `run:` scripts, and actions/github-script's `script:`, which is code too.
    const run = /^(\s*)(- )?(run|script):\s*(.*)$/.exec(lines[at] ?? '');
    if (!run) continue;
    const [, leading = '', dash, , inline] = run;
    const indent = leading.length + (dash ? 2 : 0);
    if (inline && !/^[|>]/.test(inline)) found.push([at + 1, inline]);
    for (let next = at + 1; next < lines.length; next += 1) {
      const line = lines[next] ?? '';
      if (line.trim() && line.search(/\S/) <= indent) break;
      found.push([next + 1, line]);
    }
  }
  return found;
}

describe.each(workflows)('%s', (name) => {
  const text = readFileSync(path.join(DIR, name), 'utf8');

  it('pastes nothing a pull request controls into a script', () => {
    const pasted = scriptLines(text).filter(([, line]) => pastes(line));
    expect(pasted.map(([at, line]) => `${at}: ${line.trim()}`)).toEqual([]);
  });

  it('declares its token permissions', () => {
    expect(text).toMatch(/^permissions:/m);
  });
});

describe('the rule itself', () => {
  it('sees through braces inside an expression', () => {
    expect(pastes('echo "${{ format(\'{0}\', github.head_ref) }}"')).toBe(true);
    expect(pastes('echo "${{ inputs.base_url }}"')).toBe(true);
    expect(pastes('npm run e2e -- --shard=${{ matrix.shard }}/4')).toBe(false);
  });

  it('reads a github-script script as code', () => {
    const lines = scriptLines(
      [
        '      - uses: actions/github-script@v7',
        '        with:',
        '          script: |',
        '            core.info("${{ github.event.pull_request.title }}")',
      ].join('\n')
    );
    expect(lines.some(([, line]) => pastes(line))).toBe(true);
  });
});

/**
 * A workflow file read as YAML -- the block subset workflows are written in:
 * mappings, sequences, `|` and `>` scalars, flow lists of scalars, quoted and
 * plain scalars, comments. Not a general parser (the repository has none of
 * its own to lean on): anything outside the subset throws, so a workflow
 * written another way fails the checks loudly instead of slipping past them.
 * A `>` scalar's lines are joined by single spaces, which is what GitHub reads
 * for the one-line conditions folded this way.
 */
type Yaml = string | Yaml[] | { [key: string]: Yaml };

function parseYaml(source: string): Yaml {
  const lines = source.split('\n');
  let at = 0;
  const indentOf = (line: string) => line.search(/\S/);
  const skipBlank = () => {
    while (at < lines.length && /^\s*(#.*)?$/.test(lines[at] ?? '')) at += 1;
  };
  const KEY = /^([\w.-]+|'[^']*'|"[^"]*"):(?:\s+(.*))?$/;
  const unquote = (text: string): string => {
    const value = text.trim();
    if (/^'.*'$/.test(value)) return value.slice(1, -1).replaceAll("''", "'");
    if (/^".*"$/.test(value)) {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'string') return parsed;
    }
    return value.replace(/\s+#.*$/, '');
  };

  function blockScalar(style: string, parent: number): string {
    const body: string[] = [];
    let indent = -1;
    while (at < lines.length) {
      const line = lines[at] ?? '';
      if (line.trim()) {
        if (indentOf(line) <= parent) break;
        if (indent < 0) indent = indentOf(line);
      }
      body.push(line.slice(Math.max(indent, 0)));
      at += 1;
    }
    while (body.length && !body.at(-1)?.trim()) body.pop();
    return style.startsWith('>') ? body.map((line) => line.trim()).join(' ') : body.join('\n');
  }

  function value(text: string, parent: number): Yaml {
    if (/^[|>]/.test(text)) return blockScalar(text, parent);
    if (text.startsWith('['))
      return text
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map(unquote)
        .filter(Boolean);
    if (text) return unquote(text);
    skipBlank();
    const next = lines[at] ?? '';
    if (at < lines.length && indentOf(next) > parent) return node(indentOf(next));
    if (at < lines.length && indentOf(next) === parent && /^\s*- /.test(next)) return node(parent);
    return '';
  }

  function node(indent: number): Yaml {
    skipBlank();
    return /^-( |$)/.test((lines[at] ?? '').trim()) ? sequence(indent) : mapping(indent);
  }

  function mapping(indent: number): { [key: string]: Yaml } {
    const found: { [key: string]: Yaml } = {};
    for (skipBlank(); at < lines.length; skipBlank()) {
      const line = lines[at] ?? '';
      if (indentOf(line) < indent || /^-( |$)/.test(line.trim())) break;
      const pair = indentOf(line) === indent ? KEY.exec(line.trim()) : null;
      if (!pair) throw new Error(`line ${at + 1} is not YAML this reads: ${line}`);
      at += 1;
      found[unquote(pair[1] ?? '')] = value(pair[2] ?? '', indent);
    }
    return found;
  }

  function sequence(indent: number): Yaml[] {
    const found: Yaml[] = [];
    for (skipBlank(); at < lines.length; skipBlank()) {
      const line = lines[at] ?? '';
      if (indentOf(line) !== indent || !/^-( |$)/.test(line.trim())) break;
      const rest = line.trim().slice(1).trim();
      if (KEY.test(rest)) {
        // `- key: value` opens a mapping whose keys sit two columns in.
        lines[at] = `${' '.repeat(indent + 2)}${rest}`;
        found.push(mapping(indent + 2));
      } else {
        at += 1;
        found.push(rest ? unquote(rest) : value('', indent));
      }
    }
    return found;
  }

  const document = node(0);
  skipBlank();
  if (at < lines.length) throw new Error(`line ${at + 1} is not YAML this reads: ${lines[at]}`);
  return document;
}

type Mapping = { [key: string]: Yaml };
const mappingOf = (node: Yaml | undefined): Mapping =>
  node !== undefined && typeof node === 'object' && !Array.isArray(node) ? node : {};
const listOf = (node: Yaml | undefined): Yaml[] => (Array.isArray(node) ? node : []);
const textOf = (node: Yaml | undefined): string => (typeof node === 'string' ? node : '');
const workflow = (name: string) => mappingOf(parseYaml(readFileSync(path.join(DIR, name), 'utf8')));
const stepsOf = (job: Mapping) => listOf(job['steps']).map(mappingOf);
/** A script with its comment lines left out. */
const code = (script: string) =>
  script
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

describe('the YAML reader', () => {
  it('reads every workflow here', () => {
    for (const name of workflows) expect(() => workflow(name)).not.toThrow();
  });

  it('reads the forms the checks rely on', () => {
    const read = parseYaml(
      [
        'on:',
        '  workflow_run:',
        "    workflows: ['Tests']",
        'jobs:',
        '  a:',
        '    if: >-',
        "      x == 'y' &&",
        '      z',
        '    steps:',
        '      - name: one # a comment',
        '        run: |',
        '          echo "a: b"',
        '          # kept',
        '      - uses: x@y',
      ].join('\n')
    );
    expect(read).toEqual({
      on: { workflow_run: { workflows: ['Tests'] } },
      jobs: {
        a: {
          if: "x == 'y' && z",
          steps: [{ name: 'one', run: 'echo "a: b"\n# kept' }, { uses: 'x@y' }],
        },
      },
    });
  });
});

// Tests runs on pull requests too, forks included, and workflow_run's branch
// filter matches the head branch -- so a fork's branch named main or prod that
// passed Tests triggered a deploy holding the AWS role, of the fork's commit.
// Only a test run from a push to this repository may deploy, or publish the
// images a server runs. The whole condition, exactly: one `||` added anywhere
// would let another event through.
const PUSHED_AND_PASSED =
  "github.event.workflow_run.conclusion == 'success' && " +
  "github.event.workflow_run.event == 'push' && " +
  'github.event.workflow_run.head_repository.full_name == github.repository';

describe('deploy.yml', () => {
  const jobs = mappingOf(workflow('deploy.yml')['jobs']);

  it('deploys only what was pushed to this repository and passed, or a dispatch', () => {
    expect(Object.keys(jobs)).toEqual(['deploy']);
    expect(textOf(mappingOf(jobs['deploy'])['if'])).toBe(
      `github.event_name == 'workflow_dispatch' || (${PUSHED_AND_PASSED})`
    );
  });
});

describe('publish-images.yml', () => {
  const text = readFileSync(path.join(DIR, 'publish-images.yml'), 'utf8');
  const read = workflow('publish-images.yml');
  const jobs = mappingOf(read['jobs']);
  const publish = mappingOf(jobs['publish']);
  const mainTag = mappingOf(jobs['main-tag']);
  const legs = listOf(mappingOf(mappingOf(publish['strategy'])['matrix'])['include']).map(
    mappingOf
  );
  const build = stepsOf(publish).find((step) => /docker build/.test(textOf(step['run']))) ?? {};
  const move = stepsOf(mainTag).find((step) => /docker push/.test(textOf(step['run']))) ?? {};
  const moveScript = code(textOf(move['run']));

  it('runs after Tests and on nothing else', () => {
    expect(Object.keys(mappingOf(read['on']))).toEqual(['workflow_run']);
    expect(mappingOf(mappingOf(read['on'])['workflow_run'])['workflows']).toEqual(['Tests']);
  });

  it('publishes only what was pushed to this repository and passed, once the registry is named', () => {
    expect(Object.keys(jobs)).toEqual(['publish', 'main-tag']);
    expect(textOf(publish['if'])).toBe(`${PUSHED_AND_PASSED} && vars.REGISTRY != ''`);
  });

  // `main-tag` runs only if every leg passed: an `if:` of its own (`always()`,
  // `!cancelled()`) would run it after a failed leg too.
  it('moves main only after every image is published, with no condition of its own', () => {
    expect(mainTag['needs']).toBe('publish');
    expect(Object.keys(mainTag)).not.toContain('if');
  });

  // java-library's graph library declares no licence, and publishing
  // pdf-export is that repository's decision (specs/032 R1): both are built on
  // the server, never pushed to a public registry.
  it('never builds java-library or pdf-export', () => {
    expect(code(text)).not.toMatch(/java-library|pdf-export|deploy\/java\//);
  });

  // github.sha under workflow_run is the default branch's tip, not the commit
  // Tests passed.
  it('builds, tags and moves main to the commit that was tested', () => {
    const tested = '${{ github.event.workflow_run.head_sha }}';
    expect(stepsOf(publish).map((step) => mappingOf(step['with'])['ref'])).toContain(tested);
    expect(mappingOf(build['env'])['SHA']).toBe(tested);
    expect(mappingOf(move['env'])['SHA']).toBe(tested);
    expect(code(text)).not.toMatch(/github\.sha\b/);
  });

  // A server pins a commit's tag; a rebuild under it would change the image.
  it('never rebuilds an image a commit tag already names', () => {
    const script = code(textOf(build['run']));
    const skip = /if docker manifest inspect "\$image" [^\n]*; then\n[^\n]*\n\s*exit 0\n\s*fi/.exec(
      script
    );
    expect(skip?.index).toBeLessThan(script.indexOf('docker build'));
    expect(script).toMatch(/--label "org\.opencontainers\.image\.revision=\$SHA"/);
  });

  // Runs can finish in any order: an older commit's must not move main back.
  it('moves main only while the commit is main tip, checked again before the pushes', () => {
    expect(Object.keys(read)).not.toContain('concurrency');
    expect(moveScript).toMatch(
      /tip=\$\(gh api "repos\/\$GITHUB_REPOSITORY\/commits\/main" --jq \.sha\)\n\s*if \[ "\$tip" != "\$SHA" \]; then\n[^\n]*\n\s*exit 0/
    );
    const checks = [...moveScript.matchAll(/^\s*main_is_this_commit$/gm)].map((m) => m.index);
    const firstPull = moveScript.indexOf('docker pull');
    const firstPush = moveScript.indexOf('docker push');
    expect(checks).toHaveLength(2);
    expect(checks[0]).toBeLessThan(moveScript.indexOf('docker manifest inspect'));
    expect(checks[0]).toBeLessThan(firstPull);
    expect(checks[1]).toBeGreaterThan(moveScript.lastIndexOf('docker tag'));
    expect(checks[1]).toBeLessThan(firstPush);
  });

  // Each tag moves on its own; none moves unless every commit tag is there.
  it('confirms every commit tag before moving any main tag', () => {
    const confirm = moveScript.indexOf('if ! docker manifest inspect "$REGISTRY/$name:$SHA"');
    expect(confirm).toBeGreaterThan(-1);
    expect(confirm).toBeLessThan(moveScript.indexOf('docker push'));
    expect(moveScript.slice(confirm)).toMatch(/^[^\n]*\n[^\n]*\n\s*exit 1/);
  });

  // `main` moves for exactly the images the matrix builds, whatever order a
  // leg's keys are written in.
  it('moves main for exactly the images it published', () => {
    const built = legs.map((leg) => textOf(leg['name']));
    const moved = /images=\(([^)]*)\)/.exec(moveScript)?.[1]?.split(/\s+/).filter(Boolean);
    expect(built).toContain('site');
    expect(legs.every((leg) => textOf(leg['dockerfile']))).toBe(true);
    expect(moved).toEqual(built);
    expect(moveScript).toMatch(/for name in "\$\{images\[@\]\}"/);
  });
});

describe('the Playwright image', () => {
  // The browsers come from Playwright's image, not `playwright install`. Each
  // Playwright version drives one browser build, so an image a version behind
  // or ahead of package.json's has the wrong browsers in it, and every test
  // fails to launch one.
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    devDependencies?: Record<string, string>;
  };
  const version = pkg.devDependencies?.['@playwright/test'];
  const images = workflows.flatMap((name) =>
    [
      ...readFileSync(path.join(DIR, name), 'utf8').matchAll(
        /^\s*container:\s*\n\s*image:\s*mcr\.microsoft\.com\/playwright:(\S+)/gm
      ),
    ].map(([, tag = '']) => `${name}: ${tag}`)
  );

  it('is used by both suites', () => {
    expect(images.map((image) => image.split(':')[0])).toEqual(
      expect.arrayContaining(['release-verification.yml', 'tests.yml'])
    );
  });

  it('is the version package.json pins', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const image of images)
      expect(image).toMatch(new RegExp(`: v${version?.replaceAll('.', '\\.') ?? ''}-`));
  });

  it('leaves no workflow installing browsers from the package servers', () => {
    const installs = workflows.flatMap((name) =>
      scriptLines(readFileSync(path.join(DIR, name), 'utf8'))
        .filter(([, line]) => /playwright install/.test(line))
        .map(([at]) => `${name}:${at}`)
    );
    expect(installs).toEqual([]);
  });
});
