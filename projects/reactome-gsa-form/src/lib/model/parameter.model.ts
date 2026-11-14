/** A parameter's value as the form holds it: its text read as its type (parserFor). */
export type ParameterValue = string | number | boolean;

export interface Parameter<T = ParameterValue> {
  id: string;
  /** A data source's parameters have none. */
  default?: T | undefined;
  description: string;
  display_name: string;
  name: string;
  scope: Scope;
  type: ParameterType;
  required?: boolean;
  values?: string[];
  value?: T | undefined;
}

export enum ParameterType {
  bool = 'bool',
  float = 'float',
  string = 'string',
  int = 'int',
  email = 'email',
}

export type Scope = 'common' | 'analysis' | 'dataset';
