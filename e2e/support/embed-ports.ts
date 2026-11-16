/**
 * Where e2e serves the embeddable diagram's build, and partner-style pages (spec
 * 009): 4340 and 4341, unless a run asks for ports of its own, as the pre-push
 * gate does (scripts/preflight.sh). Fixed ports made two gates on one host
 * collide: the second could not start its servers, and failed a push for it.
 */
function port(name: string, fallback: number): number {
  const asked = Number(process.env[name]);
  return Number.isInteger(asked) && asked > 0 ? asked : fallback;
}

export const EMBED_PORT = port('E2E_EMBED_PORT', 4340);
export const HOST_PAGE_PORT = port('E2E_HOST_PAGE_PORT', 4341);
