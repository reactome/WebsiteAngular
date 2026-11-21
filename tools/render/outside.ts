/**
 * The render page's requests to other hosts, answered here (spec 018 T018).
 *
 * The render page is the whole site, and as it draws a figure it asks hosts
 * other than the site's and the download site's, as a reader's browser does:
 * a diagram's ChEBI structures (one request a small molecule, about 60 for
 * R-HSA-381753), the font, and the structure viewer's script and stylesheet
 * from a CDN. A reader's browser should. A render should not: a release's
 * figures step draws about 19,000 figures, and sent them all a million
 * requests the figures do not use.
 *
 * - **A ChEBI structure** is answered with nothing: an empty 200. The diagram
 *   then removes the structure's place on its node, as it does when ChEBI has
 *   none or cannot be reached (ngx-reactome-cytoscape-style); the structures
 *   are HTML laid over the canvas, never part of an exported figure. A refusal
 *   (an aborted request, a 404) would do the same but be logged by the page as
 *   a console error, and a page that logs one is replaced (pages.ts).
 * - **Anything else** is fetched once by the service and answered from memory
 *   after: the font, the viewer's files. One request a service, not one a page.
 *   A fetch that fails is not kept, and the request goes on to its host.
 */
import { isDownload } from './local-files.ts';

/** A ChEBI structure, as the site's diagram asks for one (diagram.service.ts). */
export const CHEBI_STRUCTURE =
  /^https:\/\/www\.ebi\.ac\.uk\/chebi\/backend\/api\/public\/compound\/\d+\/structure\/?$/;

/** Headers of the answer as fetched that would not hold for the body as kept: decoded. */
const NOT_KEPT = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

/** What of Playwright's `Route` this uses: a route is one, and a test's stand-in can be. */
export interface OutsideRoute {
  request(): { url(): string; method(): string };
  fulfill(answer: {
    status: number;
    contentType?: string;
    headers?: Record<string, string>;
    body: string | Buffer;
  }): Promise<void>;
  continue(): Promise<void>;
  fetch(): Promise<{
    status(): number;
    headers(): Record<string, string>;
    body(): Promise<Buffer>;
  }>;
}

interface Kept {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** The outside requests of one service: what was answered, and what is kept. */
export class Outside {
  /** Requests answered here: structures with nothing, the rest from memory. */
  answered = 0;
  /** Requests sent on to their host, each the first of its address (or after a failure). */
  fetched = 0;
  private readonly kept = new Map<string, Promise<Kept>>();
  private readonly site: string;

  constructor(base: string) {
    this.site = new URL(base).origin;
  }

  /** Whether a request is to a host other than the site's and the download site's. */
  readonly matches = (url: URL): boolean =>
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.origin !== this.site &&
    !isDownload(url);

  /**
   * Answers one. Playwright runs a route handler itself, and a rejection there
   * ends the service (render-core.ts): so this never rejects.
   */
  readonly answer = async (route: OutsideRoute): Promise<void> => {
    try {
      const request = route.request();
      const address = request.url();
      if (CHEBI_STRUCTURE.test(address)) {
        this.answered++;
        await route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
        return;
      }
      if (request.method() !== 'GET') {
        await route.continue();
        return;
      }
      let kept = this.kept.get(address);
      const first = !kept;
      if (!kept) {
        this.fetched++;
        kept = route.fetch().then(async (response) => ({
          status: response.status(),
          headers: Object.fromEntries(
            Object.entries(response.headers()).filter(([name]) => !NOT_KEPT.has(name))
          ),
          body: await response.body(),
        }));
        this.kept.set(address, kept);
      }
      let answer: Kept;
      try {
        answer = await kept;
      } catch {
        // not kept: the next asks again, and this one goes on to its host
        if (this.kept.get(address) === kept) this.kept.delete(address);
        await route.continue();
        return;
      }
      await route.fulfill(answer);
      if (!first) this.answered++;
    } catch {
      // the page went while this was answered: nothing is waiting for it
    }
  };

  /** For /health. */
  health(): { answered: number; fetched: number } {
    return { answered: this.answered, fetched: this.fetched };
  }
}
