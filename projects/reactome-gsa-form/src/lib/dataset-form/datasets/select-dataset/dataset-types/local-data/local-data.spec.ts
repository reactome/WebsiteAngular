import { describe, expect, it } from 'vitest';
import { chosenFile } from './local-data.component';

// The card calls its file handler for a click on the card as well as for the
// file input's change, and only the input has files.
describe('the file a local-data event chose', () => {
  it("is the input's first file", () => {
    const input = document.createElement('input');
    input.type = 'file';
    const file = new File(['a\tb'], 'data.tsv');
    Object.defineProperty(input, 'files', { value: [file] });
    const change = new Event('change');
    input.dispatchEvent(change);
    expect(chosenFile(change)).toBe(file);
  });

  it('is none when the picker was closed without one', () => {
    const input = document.createElement('input');
    input.type = 'file';
    const change = new Event('change');
    input.dispatchEvent(change);
    expect(chosenFile(change)).toBeUndefined();
  });

  it('is none for a click on the card', () => {
    const card = document.createElement('p');
    const click = new MouseEvent('click');
    card.dispatchEvent(click);
    expect(chosenFile(click)).toBeUndefined();
  });
});
