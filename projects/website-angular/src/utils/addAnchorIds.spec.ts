import { describe, expect, it } from 'vitest';
import addAnchorIds from './addAnchorIds';

// The cases below are taken verbatim from
// content/documentation/userguide/reactome-fiviz, whose table of contents was
// authored in a MediaWiki and links every section by a "." encoded anchor.
describe('addAnchorIds', () => {
  it('gives a plain heading the id its table-of-contents link expects', () => {
    const html = '<a href="#Overview">1. Overview</a><h3>Overview</h3>';
    expect(addAnchorIds(html)).toContain('<h3 id="Overview">Overview</h3>');
  });

  it('matches MediaWiki "." encoded anchors', () => {
    for (const [heading, fragment] of [
      ['Gene Set/Mutation Analysis', 'Gene_Set.2FMutation_Analysis'],
      [
        'Use the Reactome Functional Interaction (FI) Network',
        'Use_the_Reactome_Functional_Interaction_.28FI.29_Network',
      ],
    ] as const) {
      const html = `<a href="#${fragment}">x</a><h3>${heading}</h3>`;
      expect(addAnchorIds(html)).toContain(`<h3 id="${fragment}">${heading}</h3>`);
    }
  });

  it('gives a heading nothing on its own page links to an id too', () => {
    // It used to be left bare, which made it unreachable from any other page.
    expect(addAnchorIds('<h3>Unlinked Section</h3>')).toBe(
      '<h3 id="Unlinked_Section">Unlinked Section</h3>'
    );
  });

  it('keeps an id already applied to a self-linking heading', () => {
    const html = '<h2><a href="#Intro">Intro</a></h2>';
    expect(addAnchorIds(html)).toContain('<h2 id="Intro">');
  });

  it('puts the id on the section heading, not a duplicate jump card above it', () => {
    const html = '<h2><a href="#Topic">Topic</a></h2><h3><a href="#Topic">Topic</a></h3>';
    const out = addAnchorIds(html);
    expect(out).toContain('<h3 id="Topic">');
    expect(out).not.toContain('<h2 id="Topic">');
  });

  it('gives every heading an id, so another page can link to its section', () => {
    // Release notes link /documentation#Reactome_Training_Materials, and the
    // documentation page itself never links to that heading.
    const out = addAnchorIds('<h3>Reactome Training Materials</h3><p>x</p>');
    expect(out).toContain('<h3 id="Reactome_Training_Materials">');
  });

  it('never gives two headings the same id', () => {
    const out = addAnchorIds('<h2>Notes</h2><h3>Notes</h3>');
    expect(out.match(/id="Notes"/g)).toHaveLength(1);
  });
});
