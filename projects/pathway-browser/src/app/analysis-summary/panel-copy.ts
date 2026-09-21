/**
 * The sentences the panel shows, as functions of what has actually arrived.
 *
 * Separate from the component because this is where the judgement is: what a
 * wait may claim, and what the panel may say about how the summary was made.
 * Every defect this feature has had was a sentence that did not match the
 * state behind it -- a complete summary called truncated, a refusal that sent
 * the reader to another page -- and none of them were reachable by a test while
 * they lived in a component this repo's setup cannot render. (`vitest.config.ts`
 * explains why: external `templateUrl`, no @analogjs/vite-plugin-angular.)
 *
 * So the copy lives here, where it can be tested, and the component binds it.
 */
import { type Disclosure } from './summary-stream';

/**
 * What the wait says, driven by what has actually arrived.
 *
 * Two states, because this stream has exactly one milestone before prose: the
 * `start` event, which means the service accepted the token and is working.
 *
 * Deliberately not the answer panel's "found N sources". Citations there are
 * gated on retrieval finishing and provably precede any text; here they arrive
 * alongside the prose, so the same line would report a milestone this endpoint
 * does not have.
 */
export function waitingMessage(started: boolean): string {
  return started ? 'Writing the summary…' : 'Reading your analysis result.';
}

/**
 * What the summary was built from, for the reader deciding whether to use it.
 *
 * Takes the tier that was **applied**, never the one requested. Ask to disclose
 * identifiers, have the lookup fail, and the aggregate summary comes back; a
 * note claiming identifiers were sent would misdescribe what went out on the
 * reader's behalf, which is the one thing this sentence exists to be right
 * about.
 *
 * Null -- no `start` seen -- reads as the aggregate case, because that is what
 * is true of a summary nothing has told us otherwise about, and because the
 * error worth avoiding is claiming identifiers were sent when they were not.
 */
export function provenance(applied: Disclosure | null): string {
  return applied === 'identifiers'
    ? 'It was given your analysis result and the identifiers from it that Reactome could not match.'
    : 'It was given your analysis result — the pathways it found — and not your identifiers.';
}
