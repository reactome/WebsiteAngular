import type { SchemaAttribute } from '../../../../model/content.model';
import type { PlainGraphObject } from '../../../../../../pathway-browser/src/app/model/graph/plain.model';
import { fieldByName, textField } from '../../../../../../pathway-browser/src/app/services/utils';

/** An attribute of the instance, with its values as shown. */
export interface AttributeRow {
  name: string;
  values: AttributeValue[];
}

/** A value shown: text, a link to the object it names, or a figure's image file. */
type AttributeValue =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; dbId: number; schemaClass?: string }
  | { type: 'figure'; text: string };

/**
 * What a Figure's url (and its displayName, which repeats it) looks like:
 * "/figures/12_GlcNAc2Man9PPDol.png". Figures are static image files under the
 * site's document root, and the database stores that root-relative path
 * verbatim.
 *
 * The path is used as the link target unchanged, rather than joined to
 * environment.host, so the image is fetched from whichever origin is serving
 * the page: the dev server proxies /figures, so it resolves to localhost, and
 * the deployed site serves the files itself.
 */
const FIGURE_PATH = /^\/figures\/[^/]/;

/**
 * The instance's attributes in the schema's order. The instance is plain (an
 * object written already is its dbId), and the schema's attribute names are
 * known only at run time, so each is read by name.
 */
export function schemaRows(instance: PlainGraphObject, attrs: SchemaAttribute[]): AttributeRow[] {
  const rows: AttributeRow[] = [];
  for (const attr of attrs) {
    const raw = fieldByName(instance, attr.name);
    if (raw === undefined || raw === null) continue;

    const hasDatabaseObjectType = attr.valueTypes.some((vt) => vt.databaseObject);
    const values = resolveValues(raw, hasDatabaseObjectType);
    if (values.length > 0) {
      rows.push({ name: attr.name, values });
    }
  }
  return rows;
}

/** The instance's own fields, in its order: when the schema cannot be read. */
export function fieldRows(instance: PlainGraphObject): AttributeRow[] {
  const rows: AttributeRow[] = [];
  const fields: [string, unknown][] = Object.entries(instance);
  for (const [key, raw] of fields) {
    if (raw === undefined || raw === null) continue;
    const values = resolveValues(raw, false);
    if (values.length > 0) {
      rows.push({ name: key, values });
    }
  }
  return rows;
}

function resolveValues(raw: unknown, hasDatabaseObjectType: boolean): AttributeValue[] {
  if (Array.isArray(raw)) {
    const result: AttributeValue[] = [];
    const items: unknown[] = raw;
    for (const item of items) {
      result.push(...resolveSingleValue(item, hasDatabaseObjectType));
    }
    return result;
  }
  return resolveSingleValue(raw, hasDatabaseObjectType);
}

function resolveSingleValue(val: unknown, hasDatabaseObjectType: boolean): AttributeValue[] {
  // Database object with dbId
  const dbId = typeof val === 'object' && val !== null ? fieldByName(val, 'dbId') : undefined;
  if (typeof dbId === 'number' && dbId) {
    const schemaClass = textField(val, 'schemaClass') || textField(val, 'className');
    return [
      {
        type: 'link',
        text: `[${schemaClass || 'Object'}:${dbId}] ${textField(val, 'displayName') || ''}`,
        dbId,
        ...(schemaClass && { schemaClass }),
      },
    ];
  }

  // Numeric ID reference (e.g. authored: [109913]) when schema says it's a database object
  if (typeof val === 'number' && hasDatabaseObjectType) {
    return [
      {
        type: 'link',
        text: `${val}`,
        dbId: val,
      },
    ];
  }

  // A figure's image file, which the browser can render on its own. The path
  // is both what is shown and where the link goes.
  if (typeof val === 'string' && FIGURE_PATH.test(val)) {
    return [{ type: 'figure', text: val }];
  }

  // Primitive
  return [
    {
      type: 'text',
      text: String(val),
    },
  ];
}
