import type { Settings } from '../model/table.model';

// The web component's attributes arrive as strings, so its table and settings
// come as JSON (`setAttribute('table', JSON.stringify(table))`). Checking the
// input rather than its value left the string unparsed, and the table threw
// on it and drew nothing.

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isNumber = (v: unknown): v is number => typeof v === 'number';
const isButton = (v: unknown): v is 'icon' | 'text' | false =>
  v === 'icon' || v === 'text' || v === false;

/** How each setting is checked: a setting added to Settings must be added here. */
const SETTING: { [K in keyof Settings]: (v: unknown) => v is Settings[K] } = {
  renameCols: isBoolean,
  renameRows: isBoolean,
  changeCells: isBoolean,
  rowToBeAdded: isNumber,
  colToBeAdded: isNumber,
  addColumn: isBoolean,
  addRow: isBoolean,
  showCols: isBoolean,
  showRows: isBoolean,
  deleteRow: isBoolean,
  deleteCol: isBoolean,
  importMapHeaders: isBoolean,
  dropReplace: isBoolean,
  uploadButton: isButton,
  downloadButton: isButton,
};

const isSettingName = (name: string): name is keyof Settings => name in SETTING;

function isSettings(v: unknown): v is Partial<Settings> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.entries(v).every(([name, value]) => isSettingName(name) && SETTING[name](value))
  );
}

const isTable = (v: unknown): v is string[][] =>
  Array.isArray(v) &&
  v.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'));

function parse(attribute: string, json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (e) {
    console.error(`The ${attribute} attribute is not JSON`, e);
    return undefined;
  }
}

/** A table as given: a table, or a table written as JSON; anything else is none. */
export function tableInput(value: string[][] | string | undefined): string[][] | undefined {
  if (typeof value !== 'string') return value;
  const parsed = parse('table', value);
  if (isTable(parsed)) return parsed;
  if (parsed !== undefined) console.error('The table attribute is not a table of strings', parsed);
  return undefined;
}

/** Settings as given: settings, or settings written as JSON; anything else is none. */
export function settingsInput(value: Partial<Settings> | string): Partial<Settings> {
  if (typeof value !== 'string') return value;
  const parsed = parse('userSettings', value);
  if (isSettings(parsed)) return parsed;
  if (parsed !== undefined) console.error('The userSettings attribute is not settings', parsed);
  return {};
}
