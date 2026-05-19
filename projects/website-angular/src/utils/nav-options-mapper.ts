import {NavLink, NavOption} from "../types/link";
import { environment } from "../../../pathway-browser/src/environments/environment";

// Links marked external: true in nav-options.json point at WAR endpoints
// (/AnalysisService, /ContentService, ...) and need the active host
// prepended; otherwise they resolve relative to the current page and on
// hosts where Apache wraps those paths in legacy chrome the user gets
// bounced out of the new site. See issue #87.
function resolveLink(link: string, external: boolean): string {
  return external ? `${environment.host}${link}` : link;
}

function mapDropdownLinks(raw: any): Record<string, NavLink> | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const mapped: Record<string, NavLink> = {};
  Object.entries(raw).forEach(([key, value]: [string, any]) => {
    if (value && typeof value === 'object') {
      const external = value.external || false;
      mapped[key] = {
        label: value.label || '',
        link: resolveLink(value.link || '', external),
        external,
        dropdownLinks: mapDropdownLinks(value['dropdown-links'])
      };
    }
  });

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

export function mapNavOptions(raw: Record<string, any>): Record<string, NavOption> {
  const mapped: Record<string, NavOption> = {};

  Object.entries(raw).forEach(([key, value]: [string, any]) => {
    if (value && typeof value === 'object') {
      const external = value.external || false;
      mapped[key] = {
        label: value.label || '',
        link: resolveLink(value.link || '', external),
        icon: value.icon,
        external,
        dropdownLinks: mapDropdownLinks(value['dropdown-links'])
      };
    }
  });

  return mapped;
}
