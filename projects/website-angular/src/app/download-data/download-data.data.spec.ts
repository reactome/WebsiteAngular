import { describe, expect, it } from 'vitest';
import { CURATOR_TOOL, FUNCTIONAL_INTERACTIONS } from './download-data.data';

/**
 * The tools (the functional-interaction networks and the Curator Tool) are
 * fetched from the download site's tools/ folder, as the release files are from
 * its release folders. A link to reactome.org/download/tools is the old web
 * server's copy: it reaches the same files only where that host forwards
 * /download/, and from beta or a release server it goes to production.
 */
describe('Download Data tools', () => {
  const links = [
    ...FUNCTIONAL_INTERACTIONS.map((fi) => fi.url),
    ...CURATOR_TOOL.installers.map((installer) => installer.url),
  ];

  it('are fetched from the download site', () => {
    for (const url of links) {
      expect(url).toMatch(/^https:\/\/download\.reactome\.org\/tools\//);
    }
  });

  it('offer the newest functional-interaction network first', () => {
    expect(FUNCTIONAL_INTERACTIONS[0]).toMatchObject({
      label: 'FI Network 2026',
      url: 'https://download.reactome.org/tools/ReactomeFIs/FIsInGene_09092026_with_annotations.txt.zip',
    });
  });
});
