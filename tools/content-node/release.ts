/**
 * The release the database holds, read once and kept (spec 014, research
 * R2): the version endpoint's handler, and what search's report, the
 * citations and /health read the release from. Moved unchanged from
 * service.ts.
 */
import { cached } from './answers.ts';
import { read } from './graph.ts';

/**
 * The release the database holds, as /data/database/version answers it: the
 * endpoint's handler, and what search's report, the event citation and
 * /health ask for the release. Named, so they call it rather than look the
 * endpoint up in the list (spec 014, research R2): once the endpoints are in
 * modules, a module that read the list would import the registry that
 * imports it.
 */
export const databaseVersion = cached('database/version', async () => {
  const [row] = await read<{ version: number | null }>(
    'MATCH (n:DBInfo) RETURN n.releaseNumber AS version LIMIT 1'
  );
  if (!row) return { status: 404, body: 'no DBInfo node' };
  return { status: 200, body: String(row.version), type: 'text/plain;charset=UTF-8' };
});
