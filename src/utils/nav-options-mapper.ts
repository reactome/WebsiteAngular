import NavLink from "../types/nav-link";
import NavOption from "../types/nav-option";

/**
 * Recursively maps JSON dropdown-links to typed NavLink objects
 */
function mapDropdownLinks(raw: any): Record<string, NavLink> | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  
  const mapped: Record<string, NavLink> = {};
  Object.entries(raw).forEach(([key, value]: [string, any]) => {
    if (value && typeof value === 'object') {
      mapped[key] = {
        label: value.label || '',
        link: value.link || '',
        dropdownLinks: mapDropdownLinks(value['dropdown-links'])
      };
    }
  });
  
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

/**
 * Maps nav-options JSON (with dropdown-links) to typed NavOption objects (with dropdownLinks)
 */
export function mapNavOptions(raw: Record<string, any>): Record<string, NavOption> {
  const mapped: Record<string, NavOption> = {};
  
  Object.entries(raw).forEach(([key, value]: [string, any]) => {
    if (value && typeof value === 'object') {
      mapped[key] = {
        label: value.label || '',
        link: value.link || '',
        icon: value.icon,
        dropdownLinks: mapDropdownLinks(value['dropdown-links'])
      };
    }
  });
  
  return mapped;
}
