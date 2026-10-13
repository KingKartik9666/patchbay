import { own, type MachineDef } from './types';

/** A text-format symbol can be a bit, a word, or any valid Unicode token. */
export function isSymbol(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\s\p{White_Space}#]/u.test(value)
    && !Array.from(value).some(symbol => {
      const point = symbol.codePointAt(0)!;
      return point >= 0xd800 && point <= 0xdfff;
    });
}

/** Multi-codepoint input symbols require explicit token boundaries. */
export function usesTokenInput(machine: MachineDef): boolean {
  return machine.alphabet.some(symbol => Array.from(symbol).length > 1);
}

export function tokenizeInput(machine: MachineDef, input: string): string[] {
  return usesTokenInput(machine)
    ? input.split(/[\s\p{White_Space}]+/u).filter(Boolean)
    : Array.from(input);
}

/** Stable spacing for all prefixes of the same machine's output tape. */
export function joinSymbols(machine: MachineDef, symbols: readonly string[]): string {
  const outputs: string[] = [];
  if (machine.outputs.kind === 'moore') {
    // A converter's Initial state may emit a word only before reading input.
    // Omitted initial output must not change how its binary step outputs join.
    const destinations = new Set<string>();
    for (const state of machine.states) {
      for (const input of machine.alphabet) {
        const destination = own(own(machine.delta, state), input);
        if (destination !== undefined) destinations.add(destination);
      }
    }
    for (const destination of destinations) {
      const output = own(machine.outputs.lambda, destination);
      if (output !== undefined) outputs.push(output);
    }
  } else {
    for (const state of machine.states) {
      for (const input of machine.alphabet) {
        const output = own(own(machine.outputs.lambda, state), input);
        if (output !== undefined) outputs.push(output);
      }
    }
  }
  const separator = [...outputs, ...symbols].some(output => Array.from(output).length > 1) ? ' ' : '';
  return symbols.join(separator);
}
