export interface ExternalLink {
  label: string;
  link: string;
}

export interface NavLink extends ExternalLink {
  external?: boolean;
  dropdownLinks?: Record<string, NavLink>;
}

export interface NavOption extends NavLink {
  icon?: string;
}

// [routerLink] treats its whole input as a path, so a link like
// "/PathwayBrowser?analysisTab=species" gets URL-encoded verbatim instead of
// being parsed into a route + query params. Split it up front so templates
// can bind [routerLink]="linkPath(x)" [queryParams]="linkQueryParams(x)".
export function linkPath(link: string): string {
  return link.split('?')[0];
}

export function linkQueryParams(link: string): Record<string, string> {
  const query = link.split('?')[1];
  if (!query) return {};
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    const [key, value] = pair.split('=');
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(value ?? '');
  }
  return params;
}