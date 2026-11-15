import { describe, expect, it } from 'vitest';

import nav from '../config/nav-options.json';
import { environment } from '../../../pathway-browser/src/environments/environment';
import { mapNavOptions } from './nav-options-mapper';

describe('mapNavOptions', () => {
  it('reads each menu and its dropdowns, the external ones on the active host', () => {
    expect(
      mapNavOptions({
        tools: {
          label: 'Tools',
          link: '/tools',
          icon: 'build',
          'dropdown-links': {
            api: { label: 'API', link: '/ContentService/', external: true },
            more: {
              label: 'More',
              link: '/more',
              'dropdown-links': { inner: { label: 'Inner', link: '/inner' } },
            },
          },
        },
      })
    ).toEqual({
      tools: {
        label: 'Tools',
        link: '/tools',
        icon: 'build',
        external: false,
        dropdownLinks: {
          api: {
            label: 'API',
            link: `${environment.host}/ContentService/`,
            external: true,
          },
          more: {
            label: 'More',
            link: '/more',
            external: false,
            dropdownLinks: { inner: { label: 'Inner', link: '/inner', external: false } },
          },
        },
      },
    });
  });

  it('leaves out what is not an entry, and reads a missing field as empty', () => {
    expect(
      mapNavOptions({ none: null, text: 'not an entry', bare: {}, empty: { 'dropdown-links': {} } })
    ).toEqual({
      bare: { label: '', link: '', external: false },
      empty: { label: '', link: '', external: false },
    });
  });

  it('maps every menu of the real nav-options.json', () => {
    const menus = mapNavOptions(nav);
    expect(Object.keys(menus)).toEqual(Object.keys(nav));
    for (const menu of Object.values(menus)) expect(menu.label).not.toBe('');
  });
});
