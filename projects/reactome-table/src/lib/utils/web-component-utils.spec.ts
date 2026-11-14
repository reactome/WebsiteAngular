import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsInput, tableInput } from './web-component-utils';

// The web component's attributes are strings: its table and settings come as JSON.
describe("the table component's inputs", () => {
  afterEach(() => vi.restoreAllMocks());

  it('takes a table as it is, and one written as JSON', () => {
    const table = [
      ['', 'A'],
      ['1', 'a'],
    ];
    expect(tableInput(table)).toBe(table);
    expect(tableInput(JSON.stringify(table))).toEqual(table);
    expect(tableInput(undefined)).toBeUndefined();
  });

  it('takes no table from JSON that is not a table of strings, or not JSON', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(tableInput('[["a", 1]]')).toBeUndefined();
    expect(tableInput('{"a": ["b"]}')).toBeUndefined();
    expect(tableInput('[[')).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(3);
  });

  it('takes settings as they are, and ones written as JSON', () => {
    const settings = { renameCols: false, rowToBeAdded: 3, downloadButton: 'icon' as const };
    expect(settingsInput(settings)).toBe(settings);
    expect(settingsInput(JSON.stringify(settings))).toEqual(settings);
  });

  it('takes no settings from JSON with an unknown setting or a wrong value', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(settingsInput('{"renameCol": true}')).toEqual({});
    expect(settingsInput('{"renameCols": "yes"}')).toEqual({});
    expect(settingsInput('{"uploadButton": true}')).toEqual({});
    expect(settingsInput('[]')).toEqual({});
    expect(settingsInput('not json')).toEqual({});
    expect(error).toHaveBeenCalledTimes(5);
  });
});
