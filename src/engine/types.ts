/** Engine-only contracts. No browser, Electron or rendering dependencies. */
export type Outputs =
  | { kind: 'mealy'; lambda: Record<string, Record<string, string>> }
  | { kind: 'moore'; lambda: Record<string, string> };

export interface MachineDef {
  states: string[];
  alphabet: string[];
  start: string;
  delta: Record<string, Record<string, string>>;
  outputs: Outputs;
}

export interface Step {
  i: number;
  from: string;
  sym: string;
  to: string;
  out: string;
}

export interface Trace {
  initialOut?: string;
  steps: Step[];
  output: string;
  fault?: { at: number; state: string; sym: string };
}

export interface ParseError {
  line: number;
  msg: string;
}

export interface ParseResult {
  machine?: MachineDef;
  errors: ParseError[];
}

/** Null-prototype records also allow states named __proto__ or constructor. */
export function record<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function own<T>(map: Record<string, T> | undefined, key: string): T | undefined {
  return map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}
