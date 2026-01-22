import NavLink from "./nav-link";

export default interface NavOption {
  label: string;
  link: string;
  icon?: string;
  dropdownLinks?: Record<string, NavLink>;
}