export default interface NavLink {
  label: string;
  link: string;
  dropdownLinks?: Record<string, NavLink>;
}