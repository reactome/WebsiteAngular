// @vitest-environment node
//
// The CI workflows' two safety rules, checked on every one of them.
//
// 1. No `${{ }}` expression a pull request controls inside a `run:` script.
//    The expression is pasted into the script before the shell sees it, so a
//    branch named `x$(curl …|sh)` ran in guardrail.yml (review, 16 Oct 2026).
//    Such values go through `env:` and are read as "$VARIABLE".
// 2. A `permissions:` block, so no job runs with the default token's scope.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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

  // Without one a job that hangs runs for GitHub's default of six hours, holding
  // a required check or a deploy half done all that time (#954). Each limit is
  // sized from the job's real run times, with the reasoning beside it.
  it('gives every job a time limit', () => {
    const unlimited = workflows.flatMap((name) =>
      Object.entries(mappingOf(workflow(name)['jobs']))
        .filter(([, job]) => {
          const limit = mappingOf(job)['timeout-minutes'];
          return !(typeof limit === 'number' && limit > 0);
        })
        .map(([id]) => `${name}: ${id}`)
    );
    expect(unlimited).toEqual([]);
  });
});

// Tests runs on pull requests too, forks included, and workflow_run's branch
// filter matches the head branch -- so a fork's branch named main that passed
// Tests would publish images with the registry role, of the fork's commit.
// Only a test run from a push to this repository may publish the images a
// server runs. The whole condition, exactly: one `||` added anywhere would let
// another event through.
const PUSHED_AND_PASSED =
  "github.event.workflow_run.conclusion == 'success' && " +
  "github.event.workflow_run.event == 'push' && " +
  'github.event.workflow_run.head_repository.full_name == github.repository';

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
  const move = stepsOf(mainTag).find((step) => /imagetools create/.test(textOf(step['run']))) ?? {};
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

  // Every script stops at its first failure, a failure anywhere in a pipe
  // included (`aws … | docker login`, `inspect | jq`), and at an unset name.
  it('starts every script with set -euo pipefail', () => {
    const scripts = Object.values(jobs)
      .flatMap((job) => stepsOf(mappingOf(job)))
      .map((step) => textOf(step['run']))
      .filter(Boolean);
    expect(scripts.length).toBeGreaterThanOrEqual(4);
    for (const script of scripts) {
      const first = script.split('\n').find((line) => line.trim() && !/^\s*#/.test(line));
      expect(first).toBe('set -euo pipefail');
    }
  });

  // Runs can finish in any order, and a newer commit's run may never come
  // (Tests failed, `[skip ci]`): an image's `main` moves only to a commit
  // ahead of the one it names, read from that image's own label, so one
  // image's tag never decides for another and a re-run repairs a partial move.
  const forward = /^\s*check_forward\(\) \{\n[\s\S]*?\n\}$/m.exec(moveScript)?.[0] ?? '';
  const loops = [
    ...moveScript.matchAll(/^\s*for name in "\$\{(\w+)\[@\]\}"; do\n([\s\S]*?)\n\s*done$/gm),
  ];
  const moveLoop = loops.find(([, , body]) => /imagetools create/.test(body ?? ''))?.[2] ?? '';
  it('moves each image main only forward, decided for that image', () => {
    expect(Object.keys(read)).not.toContain('concurrency');
    expect(forward).toMatch(/local name="\$1" current status\n\s*forward=no\n/);
    expect(forward).toMatch(
      /if ! published "\$name" main; then\n[^\n]*\n\s*forward=yes\n\s*return\n/
    );
    expect(forward).toMatch(
      /current=\$\(docker buildx imagetools inspect "\$REGISTRY\/\$name:main" \\\n\s*--format '\{\{json \.Image\}\}' \|/
    );
    expect(forward).toMatch(/\.config\.Labels\["org\.opencontainers\.image\.revision"\]/);
    expect(forward).toMatch(/if \[ -z "\$current" \]; then\n[^\n]*\n\s*forward=yes\n\s*return\n/);
    expect(forward).toMatch(/if \[ "\$current" = "\$SHA" \]; then\n[^\n]*\n\s*return\n/);
    expect(forward).toMatch(
      /status=\$\(gh api "repos\/\$GITHUB_REPOSITORY\/compare\/\$current\.\.\.\$SHA" --jq \.status\)\n/
    );
    expect(forward).not.toMatch(/images\[|\|\| true|\|\| :/);
    // Only `ahead` moves; the rest stay or fail.
    const cases = /case "\$status" in\n([\s\S]*?)\n\s*esac/.exec(forward)?.[1] ?? '';
    expect(cases).toMatch(/^\s*ahead\)\n[^\n]*\n\s*forward=yes\n\s*;;$/m);
    expect(cases).toMatch(/^\s*behind \| diverged \| identical\)\n[^\n]*\n\s*;;$/m);
    expect(cases).toMatch(/^\s*\*\)\n[^\n]*\n\s*exit 1\n\s*;;$/m);
    expect(cases.match(/^\s*[^\n]*\)( |$)/gm)).toHaveLength(3);
    expect(forward.match(/forward=yes/g)).toHaveLength(3);
  });

  // Called as a statement: as an `if` or `||` condition, `set -e` would be off
  // inside it, and a failed lookup would read as a decision.
  it('decides for every image before anything moves, and again just before each move', () => {
    const calls = [...moveScript.matchAll(/^(\s*)(.*)\bcheck_forward "\$name"(.*)$/gm)];
    expect(calls).toHaveLength(2);
    for (const [, , before, after] of calls) {
      expect(before).toBe('');
      expect(after).toBe('');
    }
    const first = loops.find(([, , body]) => /check_forward/.test(body ?? '') && body !== moveLoop);
    expect(first?.[1]).toBe('images');
    expect(first?.index).toBeLessThan(moveScript.indexOf('if ! published "$name" "$SHA"'));
    expect(moveLoop).toMatch(
      /\n\s*check_forward "\$name"\n\s*if \[ "\$forward" != yes \]; then continue; fi\n\s*docker buildx imagetools create /
    );
  });

  // Copied on the registry from the commit's tag, by digest: no pull, no
  // re-tag, no push. Without --prefer-index=false a single manifest is
  // wrapped in a new index under another digest (seen on a local registry).
  it('moves main by copying the commit tag on the registry', () => {
    expect(moveLoop).toMatch(
      /docker buildx imagetools create --prefer-index=false \\\n\s*--tag "\$REGISTRY\/\$name:main" "\$REGISTRY\/\$name:\$SHA"\n/
    );
    expect(moveScript.match(/imagetools create/g)).toHaveLength(1);
    expect(moveScript).not.toMatch(/docker (pull|push|tag)\b/);
  });

  // A `main` that names anything but the commit's digest fails the step.
  it('fails unless main names the commit tag digest after the move', () => {
    expect(moveScript).toMatch(
      /digest_of\(\) \{\n\s*docker buildx imagetools inspect "\$1" --format '\{\{json \.Manifest\}\}' \| jq -r \.digest\n\s*\}/
    );
    const want = moveLoop.indexOf('want=$(digest_of "$REGISTRY/$name:$SHA")');
    const create = moveLoop.indexOf('imagetools create');
    const got = moveLoop.indexOf('got=$(digest_of "$REGISTRY/$name:main")');
    expect(want).toBeGreaterThan(-1);
    expect(want).toBeLessThan(create);
    expect(got).toBeGreaterThan(create);
    expect(moveLoop).toMatch(
      /\[\[ "\$want" =~ \^sha256:\[0-9a-f\]\{64\}\$ \]\] \|\| \{ echo [^\n]* >&2; exit 1; \}\n/
    );
    expect(moveLoop.slice(got)).toMatch(
      /^[^\n]*\n\s*if \[ "\$got" != "\$want" \]; then\n\s*echo [^\n]*>&2\n\s*exit 1\n\s*fi\n/
    );
  });

  // Each tag moves on its own; none moves unless every commit tag is there.
  it('confirms every commit tag before moving any main tag', () => {
    const confirm = moveScript.indexOf('if ! published "$name" "$SHA"; then');
    expect(confirm).toBeGreaterThan(-1);
    expect(confirm).toBeLessThan(moveScript.indexOf('imagetools create'));
    expect(moveScript.slice(confirm)).toMatch(/^[^\n]*\n[^\n]*\n\s*exit 1/);
    const confirming = loops.find(([, , body]) => /published "\$name" "\$SHA"/.test(body ?? ''));
    expect(confirming?.[1]).toBe('images');
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

// Tests builds every image the publish builds, before the merge, and builds it
// the same way (specs/032 T033): a Dockerfile broken in a pull request fails
// that pull request rather than the publish after it. The four service images
// are legs of Tests' `images` job, the site's is the Site image job, and
// nginx's are test-config.sh's, one per deployment.
describe('Tests builds what publish-images.yml publishes', () => {
  const legsOf = (job: Mapping) =>
    listOf(mappingOf(mappingOf(job['strategy'])['matrix'])['include']).map(mappingOf);
  /** A leg as what it builds: its name, Dockerfile and build arguments. */
  const builds = (leg: Mapping) => ({
    name: textOf(leg['name']),
    dockerfile: textOf(leg['dockerfile']),
    args: textOf(leg['build-args']).split(/\s+/).filter(Boolean),
  });
  /** A script's `docker build`, continuations joined, less publish's tag and label. */
  const buildCommand = (script: string) =>
    /^\s*(docker build\b(?:[^\n]*\\\n)*[^\n]*)$/m
      .exec(code(script).replace(/\\\n\s*/g, '\\\n'))?.[1]
      ?.replace(/\\\n/g, ' ')
      .replace(/ --label "[^"]*"| -t "[^"]*"/g, '')
      .replace(/\s+/g, ' ');
  const buildStep = (job: Mapping) =>
    stepsOf(job).find((step) => /docker build/.test(textOf(step['run']))) ?? {};

  const tests = workflow('tests.yml');
  const testJobs = mappingOf(tests['jobs']);
  const images = mappingOf(testJobs['images']);
  const publish = mappingOf(mappingOf(workflow('publish-images.yml')['jobs'])['publish']);
  const published = legsOf(publish).map(builds);
  const tested = legsOf(images).map(builds);
  const site = published.find((leg) => leg.name === 'site');
  const nginx = published.filter((leg) => leg.name.startsWith('nginx-'));
  const nginxScript = readFileSync('deploy/nginx/test-config.sh', 'utf8');

  it('builds every published image, leg for leg', () => {
    expect(tested.map((leg) => leg.name)).toEqual([
      'content-node',
      'render',
      'analysis-gateway',
      'mcp',
    ]);
    const others = published.filter((leg) => leg !== site && !nginx.includes(leg));
    expect(tested).toEqual(others);
  });

  // Publish's command, less its tag and label, and less its build arguments,
  // which none of these legs has there (the check above holds them equal).
  it('builds them with publish’s command, Dockerfile and arguments', () => {
    const step = buildStep(images);
    const publishing = buildStep(publish);
    expect(tested.every((leg) => leg.args.length === 0)).toBe(true);
    expect(mappingOf(step['env'])).toEqual({ DOCKERFILE: '${{ matrix.dockerfile }}' });
    expect(mappingOf(publishing['env'])['DOCKERFILE']).toBe('${{ matrix.dockerfile }}');
    expect(mappingOf(publishing['env'])['BUILD_ARGS']).toBe('${{ matrix.build-args }}');
    expect(code(textOf(publishing['run']))).toContain(
      'for arg in $BUILD_ARGS; do args+=(--build-arg "$arg"); done'
    );
    const command = 'docker build -f "$DOCKERFILE" "${args[@]}" .';
    expect(buildCommand(textOf(publishing['run']))).toBe(command);
    expect(buildCommand(textOf(step['run']))).toBe(command.replace(' "${args[@]}"', ''));
    expect(textOf(step['run']).split('\n')[0]).toBe('set -euo pipefail');
  });

  it('builds the site’s and every nginx image as publish does', () => {
    expect(site?.args).toEqual([]);
    expect(buildCommand(textOf(buildStep(mappingOf(testJobs['site-image']))['run']))).toBe(
      `docker build -f ${site?.dockerfile} -t site .`
    );
    expect(nginx.length).toBeGreaterThan(0);
    const envs = /^for env in ([\w ]+); do$/m.exec(nginxScript)?.[1]?.split(' ') ?? [];
    expect(buildCommand(nginxScript)).toBe(
      'docker build -q -f deploy/nginx/Dockerfile --build-arg "NGINX_ENV=$env" . >/dev/null'
    );
    for (const leg of nginx) {
      expect(leg.dockerfile).toBe('deploy/nginx/Dockerfile');
      expect(leg.args).toEqual([`NGINX_ENV=${leg.name.slice('nginx-'.length)}`]);
      expect(envs).toContain(leg.name.slice('nginx-'.length));
    }
  });

  // A skipped required job reads as passed: the images are built on every run,
  // every leg, and a failed build fails the job.
  it('builds them on every run, never skipped', () => {
    expect(Object.keys(images)).not.toContain('if');
    expect(Object.keys(images)).not.toContain('continue-on-error');
    expect(Object.keys(mappingOf(mappingOf(images['strategy'])['matrix']))).toEqual(['include']);
    for (const step of stepsOf(images)) {
      expect(Object.keys(step)).not.toContain('if');
      expect(Object.keys(step)).not.toContain('continue-on-error');
    }
    expect(textOf(buildStep(images)['run'])).toBe(
      'set -euo pipefail\ndocker build -f "$DOCKERFILE" .\n'
    );
    for (const trigger of Object.values(mappingOf(tests['on']))) {
      expect(Object.keys(mappingOf(trigger)).filter((key) => key.startsWith('paths'))).toEqual([]);
    }
  });
});

// mcp's image holds reactome-mcp's main as of the build. It asked GitHub's API
// which commit that was, unauthenticated, and shared runners can exhaust the
// API's anonymous limit; BuildKit's `ADD` of the repository asks git instead,
// needing no token in CI or in compose, and still rebuilds when main moves.
it('fetches reactome-mcp over git, never through GitHub’s API', () => {
  const dockerfile = code(readFileSync('deploy/mcp/Dockerfile', 'utf8'));
  expect(dockerfile).not.toMatch(/api\.github\.com|GITHUB_TOKEN|git clone/);
  expect(dockerfile).toMatch(/^ADD --keep-git-dir=true \$\{MCP_REPO\}#\$\{MCP_REF\} \/build$/m);
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

const TAG_SCRIPT = path.resolve('.github/scripts/tag-release.sh');

// A release's tag, made by hand on release day (specs/032 T036): every
// published image's commit tag copied to `Release<NN>`, then the git tag. The
// tag is written once and production pins it, so the workflow is checked as
// YAML here and its script is run below against a stand-in registry.
describe('tag-release.yml', () => {
  const text = readFileSync(path.join(DIR, 'tag-release.yml'), 'utf8');
  const read = workflow('tag-release.yml');
  const jobs = mappingOf(read['jobs']);
  const tag = mappingOf(jobs['tag']);
  const steps = stepsOf(tag);
  const script = readFileSync(TAG_SCRIPT, 'utf8');
  const publishLegs = listOf(
    mappingOf(
      mappingOf(
        mappingOf(mappingOf(workflow('publish-images.yml')['jobs'])['publish'])['strategy']
      )['matrix']
    )['include']
  ).map((leg) => textOf(mappingOf(leg)['name']));
  const tagging = steps.find((step) => /tag-release\.sh/.test(textOf(step['run']))) ?? {};

  it('runs only when dispatched by hand, with a commit and a release', () => {
    expect(Object.keys(mappingOf(read['on']))).toEqual(['workflow_dispatch']);
    const inputs = mappingOf(mappingOf(mappingOf(read['on'])['workflow_dispatch'])['inputs']);
    expect(Object.keys(inputs)).toEqual(['commit', 'release']);
    for (const input of Object.values(inputs)) expect(mappingOf(input)['required']).toBe(true);
  });

  // Dispatched on another branch it would be that branch's workflow and
  // script, with the registry's role and a token that writes tags.
  it('runs only from main, as one job with no other condition', () => {
    expect(Object.keys(jobs)).toEqual(['tag']);
    expect(tag['if']).toBe("github.ref == 'refs/heads/main'");
    for (const step of steps) expect(Object.keys(step)).not.toContain('if');
  });

  it('asks for the registry role and the git tag, and nothing else', () => {
    expect(read['permissions']).toEqual({ 'id-token': 'write', contents: 'write' });
    expect(Object.keys(tag)).not.toContain('permissions');
  });

  it('runs one at a time and never cancels a run', () => {
    expect(read['concurrency']).toEqual({ group: 'tag-release', 'cancel-in-progress': false });
  });

  // The first step, before any checkout or credential.
  it('checks its inputs first', () => {
    const first = steps[0] ?? {};
    expect(Object.keys(first)).not.toContain('uses');
    expect(mappingOf(first['env'])).toEqual({
      COMMIT: '${{ inputs.commit }}',
      RELEASE: '${{ inputs.release }}',
    });
    const run = textOf(first['run']);
    expect(run).toContain('[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || {');
    expect(run).toContain('[[ "$RELEASE" =~ ^[1-9][0-9]{0,3}$ ]] || {');
    // The script checks them again, by the same patterns.
    expect(script).toContain('[[ "${COMMIT:-}" =~ ^[0-9a-f]{40}$ ]] || refuse');
    expect(script).toContain('[[ "${RELEASE:-}" =~ ^[1-9][0-9]{0,3}$ ]] || refuse');
  });

  it('checks out main whole, and pins every action by commit', () => {
    const uses = steps.map((step) => textOf(step['uses'])).filter(Boolean);
    expect(uses).toHaveLength(2);
    for (const action of uses) expect(action).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
    const checkout = steps.find((step) => textOf(step['uses']).startsWith('actions/checkout@'));
    expect(mappingOf(checkout?.['with'])).toEqual({ 'fetch-depth': 0 });
    expect(steps.indexOf(checkout ?? {})).toBeGreaterThan(0);
  });

  // publish-images.yml's list, so a release is every image a server pulls.
  it('tags exactly the images publish-images.yml publishes', () => {
    expect(publishLegs).toContain('site');
    expect(textOf(mappingOf(tagging['env'])['IMAGES']).split(' ')).toEqual(publishLegs);
    expect(mappingOf(tagging['env'])['COMMIT']).toBe('${{ inputs.commit }}');
    expect(mappingOf(tagging['env'])['RELEASE']).toBe('${{ inputs.release }}');
    expect(textOf(tagging['run'])).toBe('set -euo pipefail\nbash .github/scripts/tag-release.sh\n');
  });

  it('starts every script with set -euo pipefail, and never carries on after a failure', () => {
    const scripts = steps.map((step) => textOf(step['run'])).filter(Boolean);
    expect(scripts).toHaveLength(3);
    for (const run of scripts) expect(run.split('\n')[0]).toBe('set -euo pipefail');
    expect(code(script).split('\n').filter(Boolean).slice(0, 2)).toEqual([
      'set -euo pipefail',
      'shopt -s inherit_errexit',
    ]);
    expect(code(text)).not.toMatch(/continue-on-error/);
    expect(code(script)).not.toMatch(/\|\| true|\|\| :/);
  });

  // The registry's own not-found only, as publish-images.yml reads it.
  it('reads the registry as publish-images.yml does', () => {
    const lookup = (source: string) => /^published\(\) \{\n[\s\S]*?\n\}$/m.exec(code(source))?.[0];
    const publishing = Object.values(mappingOf(workflow('publish-images.yml')['jobs']))
      .flatMap((job) => stepsOf(mappingOf(job)))
      .map((step) => lookup(textOf(step['run'])))
      .filter(Boolean);
    expect(publishing).toHaveLength(2);
    expect(lookup(script)).toMatch(/^published\(\) \{\n/);
    for (const theirs of publishing) expect(lookup(script)).toBe(theirs);
  });

  // Copied on the registry by digest, once per image; never forced, moved or
  // deleted, in git or on the registry.
  it('copies by digest and never forces, moves or deletes a tag', () => {
    const body = code(script);
    expect(body.match(/imagetools create/g)).toEqual(['imagetools create']);
    expect(body).toMatch(
      /docker buildx imagetools create --prefer-index=false \\\n\s*--tag "\$REGISTRY\/\$name:\$TAG" "\$REGISTRY\/\$name:\$COMMIT"\n/
    );
    expect(body).not.toMatch(/docker (pull|push|tag)\b|batch-delete-image|put-image/);
    expect(body).not.toMatch(/--force|\s-f\b|--delete|\s-d\b|\+refs|:refs\/tags|--mirror/);
    expect(body.match(/git push/g)).toEqual(['git push']);
    expect(body).toMatch(/\ngit push origin "refs\/tags\/\$TAG"\n/);
  });
});

// The script itself, run against a stand-in registry (`aws` and `docker` on
// PATH, keeping each tag's digest as a file) and a throwaway repository with
// a bare `origin`: what it refuses, what it writes, and a run stopped
// part-way and run again.
describe('tag-release.sh', () => {
  const REGISTRY = 'registry.test/reactome';
  const IMAGES = ['site', 'content-node', 'render'];
  const digest = (seed: string) => `sha256:${createHash('sha256').update(seed).digest('hex')}`;
  // describe-images as the AWS CLI answers it: 254 for any error the service
  // returns, named in the message.
  const AWS = `#!/usr/bin/env bash
echo "aws $*" >> "$STUB_LOG"
if [ -n "\${STUB_AWS_DENIED:-}" ]; then
  echo "An error occurred (AccessDeniedException) when calling the DescribeImages operation: denied" >&2
  exit 254
fi
while [ $# -gt 0 ]; do
  case "$1" in
    --repository-name) name=$2; shift ;;
    --image-ids) tag=\${2#imageTag=}; shift ;;
  esac
  shift
done
[ -f "$STUB_REGISTRY/$name/$tag" ] && exit 0
echo "An error occurred (ImageNotFoundException) when calling the DescribeImages operation: none" >&2
exit 254
`;
  // imagetools inspect and create, on the files. Without --prefer-index=false
  // a single manifest is wrapped in a new index, under another digest.
  const DOCKER = `#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
file() { local ref="\${1#"$REGISTRY"/}"; echo "$STUB_REGISTRY/\${ref%%:*}/\${ref#*:}"; }
case "$3" in
  inspect)
    printf '{"digest":"%s"}\\n' "$(cat "$(file "$4")")"
    ;;
  create)
    dest=$(file "$6")
    [ "$6" != "$REGISTRY/\${STUB_FAIL_ON:-}:\${6##*:}" ] || { echo "registry error" >&2; exit 1; }
    if [ "$4" = --prefer-index=false ]; then cp "$(file "$7")" "$dest"
    else echo "sha256:$(echo index | sha256sum | cut -c1-64)" > "$dest"; fi
    # Another writer, between this copy and the next.
    [ -z "\${STUB_HOOK:-}" ] || bash "$STUB_HOOK" "$6"
    ;;
  *) exit 2 ;;
esac
`;
  const COMPOSE = (release: number) =>
    `services:\n  graphdb:\n    image: reactome/graphdb_readonly:Release${release}\n`;

  let root = '';
  let commits: Record<'released' | 'later' | 'branch', string>;
  const env = (extra: Record<string, string> = {}) => ({
    PATH: `${path.join(root, 'bin')}:${process.env['PATH'] ?? ''}`,
    HOME: root,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    STUB_LOG: path.join(root, 'log'),
    STUB_REGISTRY: path.join(root, 'registry'),
    ...extra,
  });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=/dev/null', ...args],
      { cwd, env: env(), encoding: 'utf8', stdio: 'pipe' }
    ).trim();
  const put = (image: string, tag: string, value: string) => {
    mkdirSync(path.join(root, 'registry', image), { recursive: true });
    writeFileSync(path.join(root, 'registry', image, tag), `${value}\n`);
  };
  const held = (image: string, tag: string) => {
    const file = path.join(root, 'registry', image, tag);
    return existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined;
  };
  const remoteTag = () =>
    git(path.join(root, 'clone'), 'ls-remote', 'origin', 'refs/tags/Release99*');
  const copies = () =>
    existsSync(path.join(root, 'log'))
      ? readFileSync(path.join(root, 'log'), 'utf8')
          .split('\n')
          .filter((line) => / create /.test(line))
      : [];
  const run = (inputs: Record<string, string> = {}) => {
    const done = spawnSync('bash', [TAG_SCRIPT], {
      cwd: path.join(root, 'clone'),
      encoding: 'utf8',
      env: env({
        REGISTRY,
        IMAGES: IMAGES.join(' '),
        GITHUB_REF: 'refs/heads/main',
        COMMIT: commits.released,
        RELEASE: '99',
        ...inputs,
      }),
    });
    return { status: done.status, output: done.stdout + done.stderr };
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'tag-release-'));
    mkdirSync(path.join(root, 'bin'));
    writeFileSync(path.join(root, 'bin', 'aws'), AWS, { mode: 0o755 });
    writeFileSync(path.join(root, 'bin', 'docker'), DOCKER, { mode: 0o755 });
    const work = path.join(root, 'work');
    mkdirSync(work);
    git(root, 'init', '-q', '--bare', '-b', 'main', 'origin.git');
    git(work, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'docker-compose.yml'), COMPOSE(99));
    git(work, 'add', '.');
    git(work, 'commit', '-q', '-m', 'release 99');
    const released = git(work, 'rev-parse', 'HEAD');
    git(work, 'commit', '-q', '--allow-empty', '-m', 'later');
    const later = git(work, 'rev-parse', 'HEAD');
    git(work, 'checkout', '-q', '-b', 'branch', released);
    git(work, 'commit', '-q', '--allow-empty', '-m', 'not on main');
    const branch = git(work, 'rev-parse', 'HEAD');
    git(work, 'push', '-q', path.join(root, 'origin.git'), 'main', 'branch');
    git(root, 'clone', '-q', path.join(root, 'origin.git'), 'clone');
    commits = { released, later, branch };
    for (const image of IMAGES) {
      put(image, released, digest(`${image}@${released}`));
      put(image, later, digest(`${image}@${later}`));
    }
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('tags every image at the commit tag digest, then the commit', () => {
    const { status, output } = run();
    expect(output).not.toMatch(/refused/);
    expect(status).toBe(0);
    for (const image of IMAGES)
      expect(held(image, 'Release99')).toBe(digest(`${image}@${commits.released}`));
    expect(copies()).toHaveLength(IMAGES.length);
    // Annotated, on the commit.
    const refs = remoteTag();
    expect(refs).toContain(`${commits.released}\trefs/tags/Release99^{}`);
    expect(git(path.join(root, 'origin.git'), 'cat-file', '-t', 'Release99')).toBe('tag');
  });

  it('refuses inputs that are not a full commit id and a release number, touching nothing', () => {
    const bad = [
      { COMMIT: commits.released.slice(0, 12) },
      { COMMIT: commits.released.toUpperCase() },
      { COMMIT: `${commits.released}\n` },
      { COMMIT: `${commits.released} ` },
      { COMMIT: 'main' },
      { RELEASE: '0' },
      { RELEASE: '099' },
      { RELEASE: '-99' },
      { RELEASE: '99a' },
      { RELEASE: 'Release99' },
      { RELEASE: '' },
      { RELEASE: '99999' },
      { GITHUB_REF: 'refs/heads/branch' },
      { GITHUB_REF: 'refs/tags/main' },
      { REGISTRY: '' },
    ];
    for (const inputs of bad) expect(run(inputs).status, JSON.stringify(inputs)).toBe(1);
    expect(existsSync(path.join(root, 'log'))).toBe(false);
  });

  it('checks the inputs in the workflow’s first step by the same rules', () => {
    const first = textOf(
      stepsOf(mappingOf(mappingOf(workflow('tag-release.yml')['jobs'])['tag']))[0]?.['run']
    );
    const check = (COMMIT: string, RELEASE: string) =>
      spawnSync('bash', ['-c', first], {
        env: { PATH: process.env['PATH'] ?? '', COMMIT, RELEASE },
      }).status;
    expect(check(commits.released, '99')).toBe(0);
    expect(check(commits.released, '1')).toBe(0);
    expect(check(commits.released.slice(1), '99')).toBe(1);
    expect(check(`${commits.released}\nx`, '99')).toBe(1);
    expect(check(commits.released, '099')).toBe(1);
    expect(check(commits.released, '0')).toBe(1);
    expect(check(commits.released, '9 9')).toBe(1);
  });

  it('refuses a commit that is not on main, or not here', () => {
    expect(run({ COMMIT: commits.branch }).output).toMatch(/refused: \w+ is not on main/);
    expect(run({ COMMIT: 'f'.repeat(40) }).output).toMatch(/refused: f+ is not a commit here/);
    expect(copies()).toEqual([]);
    expect(remoteTag()).toBe('');
  });

  // The production checkout at the git tag runs the graph its compose names.
  it('refuses a release the commit’s compose file does not name', () => {
    const { status, output } = run({ RELEASE: '100' });
    expect(status).toBe(1);
    expect(output).toMatch(/does not name release 100's graph/);
    expect(run({ RELEASE: '9' }).status).toBe(1);
    expect(copies()).toEqual([]);
  });

  it('refuses unless every image has the commit tag, tagging none', () => {
    rmSync(path.join(root, 'registry', 'render', commits.released));
    const { status, output } = run();
    expect(status).toBe(1);
    expect(output).toMatch(/render:\w+ is not in the registry/);
    expect(copies()).toEqual([]);
    expect(remoteTag()).toBe('');
  });

  it('fails on a registry that cannot answer, never reading it as absent', () => {
    const { status, output } = run({ STUB_AWS_DENIED: '1' });
    expect(status).toBe(1);
    expect(output).toMatch(/the registry did not answer \(exit 254\)/);
    expect(copies()).toEqual([]);
  });

  // Written once: checked for every image before anything is written.
  it('refuses, before writing anything, a Release tag on any image at another digest', () => {
    put('render', 'Release99', digest(`render@${commits.later}`));
    const { status, output } = run();
    expect(status).toBe(1);
    expect(output).toMatch(/render:Release99 already names sha256:\w+, not/);
    expect(copies()).toEqual([]);
    expect(held('site', 'Release99')).toBeUndefined();
    expect(held('render', 'Release99')).toBe(digest(`render@${commits.later}`));
    expect(remoteTag()).toBe('');
  });

  it('refuses, before writing anything, a git tag on another commit', () => {
    git(path.join(root, 'clone'), 'tag', 'Release99', commits.later);
    git(path.join(root, 'clone'), 'push', '-q', 'origin', 'refs/tags/Release99');
    const { status, output } = run();
    expect(status).toBe(1);
    expect(output).toMatch(/the git tag Release99 already names \w+, not/);
    expect(copies()).toEqual([]);
    expect(remoteTag()).toBe(`${commits.later}\trefs/tags/Release99`);
  });

  it('fails, with no git tag, when a copy names another digest', () => {
    const docker = path.join(root, 'bin', 'docker');
    writeFileSync(docker, DOCKER.replace('= --prefer-index=false ]', '= --never ]'));
    const { status, output } = run();
    expect(status).toBe(1);
    expect(output).toMatch(/site: Release99 names sha256:\w+, not/);
    expect(remoteTag()).toBe('');
  });

  // Another writer between the first checks and a copy: each image is checked
  // again just before its own copy, and every image once more before the git tag.
  const hook = (script: string) => {
    const file = path.join(root, 'hook');
    writeFileSync(file, `${script}exit 0\n`);
    return { STUB_HOOK: file };
  };
  it('refuses a Release tag that appears before its image is copied, leaving it alone', () => {
    const other = digest(`render@${commits.later}`);
    const { status, output } = run(
      hook(`[[ "$1" == */site:Release99 ]] && echo ${other} > "$STUB_REGISTRY/render/Release99"\n`)
    );
    expect(status).toBe(1);
    expect(output).toMatch(/render:Release99 already names sha256:\w+, not/);
    expect(held('render', 'Release99')).toBe(other);
    expect(remoteTag()).toBe('');
  });

  it('pushes no git tag unless every image still has its Release tag', () => {
    const { status, output } = run(
      hook(`[[ "$1" == */render:Release99 ]] && rm "$STUB_REGISTRY/site/Release99"\n`)
    );
    expect(status).toBe(1);
    expect(output).toMatch(/site:Release99 is not there after tagging/);
    expect(remoteTag()).toBe('');
  });

  // Stopped part-way, it is finished by the same run again; and once finished,
  // run again it writes nothing.
  it('finishes a run stopped part-way, and then writes nothing', () => {
    const stopped = run({ STUB_FAIL_ON: 'render' });
    expect(stopped.status).toBe(1);
    expect(held('site', 'Release99')).toBe(digest(`site@${commits.released}`));
    expect(held('render', 'Release99')).toBeUndefined();
    expect(remoteTag()).toBe('');

    rmSync(path.join(root, 'log'));
    const again = run();
    expect(again.output).not.toMatch(/refused/);
    expect(again.status).toBe(0);
    expect(copies().map((line) => line.split(' ').at(-1))).toEqual([
      `${REGISTRY}/render:${commits.released}`,
    ]);
    expect(remoteTag()).toContain(`${commits.released}\trefs/tags/Release99^{}`);

    rmSync(path.join(root, 'log'));
    const done = run();
    expect(done.status).toBe(0);
    expect(done.output).toMatch(/the git tag Release99 names \w+ already/);
    expect(copies()).toEqual([]);
    // But never for another commit.
    for (const image of IMAGES) put(image, commits.later, digest(`${image}@${commits.later}`));
    expect(run({ COMMIT: commits.later }).status).toBe(1);
    expect(copies()).toEqual([]);
  });
});
