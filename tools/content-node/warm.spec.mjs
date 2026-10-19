// @vitest-environment node
//
// warm.mjs fills the edge cache after a release's purge. A list spelled
// unlike the site's requests would warm entries no reader asks for, and a
// warm-up that did not say which answers were not cacheable would report
// success over nothing.
import { describe, expect, it } from 'vitest';
import { standardForm } from './parameters.mjs';
import { classify } from './classify.mjs';
import { warm, warmList } from './warm.mjs';

const answers = {
  '/ContentService/data/species/main': [{ taxId: '9606' }, { taxId: '10090' }],
  '/ContentService/data/pathways/top/9606': [{ stId: 'R-HSA-1640170' }, { stId: 'R-HSA-162582' }],
};
const getJson = async (path) => answers[path];

describe('warmList', () => {
  it("is the release's species and human top-level pathways, each URL once", async () => {
    const list = await warmList(getJson);
    expect(list).toContain('/ContentService/data/pathways/top/10090');
    expect(list).toContain(
      '/ContentService/data/event/R-HSA-162582/ancestors?includeRef=true&view=nested-aggregated'
    );
    expect(list.filter((path) => path.includes('enhanced/v2/R-HSA-1640170'))).toHaveLength(2);
    expect(new Set(list).size).toBe(list.length);
  });

  it('asks only for URLs in standard form, which the edge keeps', async () => {
    for (const path of await warmList(getJson)) {
      const found = classify('GET', path);
      expect([path, found?.ok]).toEqual([path, true]);
      expect(standardForm(found.endpoint, path)).toEqual({ ok: true });
    }
  });
});

describe('warm', () => {
  it('asks for each once, and names each answer that is not a cacheable 200', async () => {
    const asked = [];
    const fetch = async (url) => {
      asked.push(url);
      const standard = !url.endsWith('/b');
      const headers = new Map(standard ? [['x-cache-rule', 'standard']] : []);
      return {
        status: url.endsWith('/c') ? 404 : 200,
        headers: { get: (name) => headers.get(name) ?? null },
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    };
    const missed = await warm('https://site', ['/a', '/b', '/c'], { fetch, pause: 0 });
    expect(asked).toEqual(['https://site/a', 'https://site/b', 'https://site/c']);
    expect(missed).toEqual(['200 - /b', '404 standard /c']);
  });
});
