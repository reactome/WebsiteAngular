export interface ExternalLink {
  label: string;
  link: string;
}

export interface NavLink extends ExternalLink {
  dropdownLinks?: Record<string, NavLink>;
}

export interface NavOption extends NavLink {
  icon?: string;
}