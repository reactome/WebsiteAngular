import { afterEach, describe, expect, it, vi } from 'vitest';
import { Style } from './style';
import { extract } from './properties-utils';
import type { UserProperties } from './properties';

/** A Style on a container carrying these CSS variables. */
function styleWith(vars: Record<string, string> = {}, user: UserProperties = {}) {
  const container = document.createElement('div');
  for (const [name, value] of Object.entries(vars)) container.style.setProperty(name, value);
  document.body.appendChild(container);
  return new Style(container, user);
}

describe('the style properties', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps a setting turned off', () => {
    // Every falsy value was taken for a missing one and replaced by the
    // default -- so a feature could not be turned off.
    const style = styleWith({}, { features: { compare: false, interactors: false } });
    expect(extract(style.properties.features.compare)).toBe(false);
    expect(extract(style.properties.features.interactors)).toBe(false);
  });

  it('takes a CSS value of 0 as 0', () => {
    const style = styleWith({ '--compartment-opacity': '0' });
    expect(extract(style.properties.compartment.opacity)).toBe(0);
  });

  it('reads the palettes the site sets, without logging', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // As src/styles.scss writes them: single-quoted colours, and a name.
    const style = styleWith({
      '--analysis-uni-palette': "[ [0, '#FFFFE0'], [1, '#00429D']]",
      '--analysis-bi-palette': "'viridis'",
    });
    expect(extract(style.properties.analysis.unidirectionalPalette)).toEqual([
      [0, '#FFFFE0'],
      [1, '#00429D'],
    ]);
    expect(extract(style.properties.analysis.bidirectionalPalette)).toBe('viridis');
    expect(errors).not.toHaveBeenCalled();
  });
});
