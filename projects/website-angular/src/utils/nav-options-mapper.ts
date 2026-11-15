import { NavLink, NavOption } from '../types/link';
import { environment } from '../../../pathway-browser/src/environments/environment';

// Links marked external: true in nav-options.json point at WAR endpoints
// (/AnalysisService, /ContentService, ...) and need the active host
// prepended; otherwise they resolve relative to the current page and on
// hosts where Apache wraps those paths in legacy chrome the user gets
// bounced out of the new site. See issue #87.
function resolveLink(link: string, external: boolean): string {
  return external ? `${environment.host}${link}` : link;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** A field of nav-options.json read as text: empty where it is none. */
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** An entry's own fields, as both a menu and its dropdowns have them. */
function linkOf(value: Record<string, unknown>): NavLink {
  const external = Boolean(value['external']);
  const dropdownLinks = mapDropdownLinks(value['dropdown-links']);
  return {
    label: text(value['label']),
    link: resolveLink(text(value['link']), external),
    external,
    ...(dropdownLinks && { dropdownLinks }),
  };
}

function mapDropdownLinks(raw: unknown): Record<string, NavLink> | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const mapped: Record<string, NavLink> = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (isRecord(value)) mapped[key] = linkOf(value);
  });

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

export function mapNavOptions(raw: Record<string, unknown>): Record<string, NavOption> {
  const mapped: Record<string, NavOption> = {};

  Object.entries(raw).forEach(([key, value]) => {
    if (isRecord(value)) {
      const icon = value['icon'];
      mapped[key] = { ...linkOf(value), ...(typeof icon === 'string' && { icon }) };
    }
  });

  return mapped;
}
