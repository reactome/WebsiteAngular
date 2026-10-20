/**
 * The content API's real answers on record (spec 012, research R2): the
 * end-to-end recordings, and the corpus record.ts makes for what they miss.
 *
 * Only a successful answer with a JSON body can be checked against a type.
 * The rest are counted, not dropped silently: an aborted request, an answer
 * the recorder kept no body for, an error, a text or binary answer.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './compile.ts';

const HARS = path.join(ROOT, 'e2e', 'har');
const RECORDED = path.join(import.meta.dirname, 'recorded');

const PREFIX = '/ContentService';

/** A successful JSON answer on record, its path under /ContentService. */
export interface RecordedAnswer {
  method: string;
  path: string;
  query: URLSearchParams;
  source: string;
  body: string;
}

/** What could not be checked, by reason. */
export interface Skipped {
  notOk: number;
  noBody: number;
  notJson: number;
}

/** One entry of a HAR, as much of it as is read here. */
export interface HarEntry {
  request: { method: string; url: string };
  response: { status: number; content?: { _file?: string; mimeType?: string } };
}

function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * {answers: [{method, path, query, source, body}], skipped: {notOk, noBody,
 * notJson}}. `path` is under /ContentService, without the prefix; `query` is
 * the URLSearchParams sent.
 */
export function recordedAnswers({ hars = HARS, recorded = RECORDED } = {}): {
  answers: RecordedAnswer[];
  skipped: Skipped;
} {
  const answers: RecordedAnswer[] = [];
  const skipped: Skipped = { notOk: 0, noBody: 0, notJson: 0 };
  for (const name of readdirSync(hars).filter((f) => f.endsWith('.har'))) {
    const { entries } = (
      JSON.parse(readFileSync(path.join(hars, name), 'utf8')) as { log: { entries: HarEntry[] } }
    ).log;
    for (const { request, response } of entries) {
      const url = new URL(request.url, 'http://x');
      if (!url.pathname.startsWith(`${PREFIX}/`)) continue;
      if (response.status !== 200) {
        skipped.notOk++;
        continue;
      }
      const file = response.content?._file;
      if (!file) {
        skipped.noBody++;
        continue;
      }
      // By the body, not its media type: the database version is a JSON
      // number served as text/plain, and the site parses it as one.
      const body = readFileSync(path.join(hars, file), 'utf8');
      if (!parses(body)) {
        skipped.notJson++;
        continue;
      }
      answers.push({
        method: request.method,
        path: url.pathname.slice(PREFIX.length),
        query: url.searchParams,
        source: name,
        body,
      });
    }
  }
  if (existsSync(recorded))
    for (const name of readdirSync(recorded).filter((f) => f.endsWith('.json')))
      for (const { request, answer } of JSON.parse(
        readFileSync(path.join(recorded, name), 'utf8')
      ) as { request: string; answer: unknown }[]) {
        const [method, target] = request.split(' ');
        if (!method || !target) throw new Error(`${name}: "${request}" is not "<method> <url>"`);
        const url = new URL(target, 'http://x');
        answers.push({
          method,
          path: url.pathname.slice(PREFIX.length),
          query: url.searchParams,
          source: name,
          body: JSON.stringify(answer),
        });
      }
  return { answers, skipped };
}
