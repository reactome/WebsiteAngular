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
import { parse } from 'yaml';

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

/** A workflow file read as YAML, by the parser the repository depends on. */
type Mapping = { [key: string]: unknown };
const isMapping = (node: unknown): node is Mapping =>
  node !== null && typeof node === 'object' && !Array.isArray(node);
const mappingOf = (node: unknown): Mapping => (isMapping(node) ? node : {});
const listOf = (node: unknown): unknown[] => (Array.isArray(node) ? node : []);
const textOf = (node: unknown): string => (typeof node === 'string' ? node : '');
function workflow(name: string): Mapping {
  const document: unknown = parse(readFileSync(path.join(DIR, name), 'utf8'));
  return mappingOf(document);
}
const stepsOf = (job: Mapping) => listOf(job['steps']).map(mappingOf);
/** A script with its comment lines left out. */
const code = (script: string) =>
  script
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

describe('the workflows as YAML', () => {
  it('parses every workflow here', () => {
    for (const name of workflows) expect(Object.keys(workflow(name))).toContain('jobs');
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

  // Only the registry's own "not found" reads as absent: the AWS CLI exits 254
  // for any error the service returns and names it in the message. Anything
  // else (no access, no repository, no answer) must fail, never mean "build it"
  // or "missing".
  const lookup = (script: string) => /^\s*published\(\) \{\n[\s\S]*?\n\}$/m.exec(script)?.[0];
  it('takes an image as absent only on the registry saying so', () => {
    const scripts = [code(textOf(build['run'])), moveScript];
    for (const script of scripts) {
      const found = lookup(script) ?? '';
      expect(found).toMatch(
        /err=\$\(aws ecr-public describe-images --region us-east-1 \\\n\s*--repository-name "\$1" --image-ids imageTag="\$2" 2>&1 > \/dev\/null\) \|\| status=\$\?/
      );
      expect(found).toMatch(/if \[ "\$status" -eq 0 \]; then return 0; fi\n/);
      expect(found).toMatch(
        /if \[ "\$status" -eq 254 \] &&\n\s*\[\[ "\$err" == \*"\(ImageNotFoundException\) when calling the DescribeImages operation"\* \]\]; then\n\s*return 1\n\s*fi\n[^\n]*\n\s*exit 1\n\s*\}$/
      );
      expect(script).not.toMatch(/manifest inspect/);
    }
    expect(lookup(scripts[0] ?? '')).toBe(lookup(moveScript));
  });

  // A server pins a commit's tag; a rebuild under it would change the image.
  it('never rebuilds an image a commit tag already names', () => {
    const script = code(textOf(build['run']));
    const skip = /if published "\$NAME" "\$SHA"; then\n[^\n]*\n\s*exit 0\n\s*fi/.exec(script);
    expect(skip?.index).toBeLessThan(script.indexOf('docker build'));
    expect(script).toMatch(/--label "org\.opencontainers\.image\.revision=\$SHA"/);
  });

  // Runs can finish in any order, and a newer commit's run may never come
  // (Tests failed, `[skip ci]`): `main` moves only to a commit ahead of the
  // one it names, read from the label of the image pushed last.
  it('moves main only forward, checked again before the pushes', () => {
    expect(Object.keys(read)).not.toContain('concurrency');
    const forward = /^\s*main_moves_forward\(\) \{\n[\s\S]*?\n\}$/m.exec(moveScript)?.[0] ?? '';
    expect(forward).toMatch(/local last="\$\{images\[-1\]\}"/);
    expect(forward).toMatch(/if ! published "\$last" main; then\n[^\n]*\n\s*return\n/);
    expect(forward).toMatch(
      /current=\$\(docker buildx imagetools inspect "\$REGISTRY\/\$last:main" \\\n\s*--format '\{\{json \.Image\}\}' \|/
    );
    expect(forward).toMatch(/\.config\.Labels\["org\.opencontainers\.image\.revision"\]/);
    expect(forward).toMatch(/if \[ "\$current" = "\$SHA" \]; then\n[^\n]*\n\s*exit 0\n/);
    expect(forward).toMatch(
      /status=\$\(gh api "repos\/\$GITHUB_REPOSITORY\/compare\/\$current\.\.\.\$SHA" --jq \.status\)\n/
    );
    // Only `ahead` goes on; the rest stay or fail.
    const cases = /case "\$status" in\n([\s\S]*?)\n\s*esac/.exec(forward)?.[1] ?? '';
    expect(cases).toMatch(/^\s*ahead\) echo [^\n;]*;;$/m);
    expect(cases).toMatch(/^\s*behind \| diverged \| identical\)\n[^\n]*\n\s*exit 0\n\s*;;$/m);
    expect(cases).toMatch(/^\s*\*\)\n[^\n]*\n\s*exit 1\n\s*;;$/m);
    expect(cases.match(/^\s*[^\n]*\)( |$)/gm)).toHaveLength(3);

    const checks = [...moveScript.matchAll(/^\s*main_moves_forward$/gm)].map((m) => m.index);
    const firstPull = moveScript.indexOf('docker pull');
    const firstPush = moveScript.indexOf('docker push');
    expect(checks).toHaveLength(2);
    expect(checks[0]).toBeLessThan(moveScript.indexOf('if ! published "$name" "$SHA"'));
    expect(checks[0]).toBeLessThan(firstPull);
    expect(checks[1]).toBeGreaterThan(moveScript.lastIndexOf('docker tag'));
    expect(checks[1]).toBeLessThan(firstPush);
  });

  // Each tag moves on its own; none moves unless every commit tag is there.
  it('confirms every commit tag before moving any main tag', () => {
    const confirm = moveScript.indexOf('if ! published "$name" "$SHA"; then');
    expect(confirm).toBeGreaterThan(-1);
    expect(confirm).toBeLessThan(moveScript.indexOf('docker push'));
    expect(moveScript.slice(confirm)).toMatch(/^[^\n]*\n[^\n]*\n\s*exit 1/);
  });

  // Every check above is on that one step: a second step touching `main`
  // would move it unchecked.
  it('touches main in one step only, the checked one', () => {
    const steps = Object.values(jobs).flatMap((job) => stepsOf(mappingOf(job)));
    const body = (step: Mapping) => JSON.stringify({ ...step, run: code(textOf(step['run'])) });
    const touches = steps.filter((step) =>
      /:main\b|imagetools create|docker push/.test(body(step))
    );
    expect(touches.filter((step) => step !== build)).toEqual([move]);
    expect(body(build)).not.toMatch(/:main\b|imagetools create/);
  });

  // A failing step must fail its job: a leg that failed but carried on would
  // let `main` move without its image, and a failed check would be ignored.
  it('never carries on after a failure', () => {
    expect(code(text)).not.toMatch(/continue-on-error/);
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
