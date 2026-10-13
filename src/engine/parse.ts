import { own, record, type MachineDef, type ParseError, type ParseResult } from './types';
import { isSymbol } from './symbols';

interface SourceLine {
  line: number;
  tokens: string[];
}

/** Parse the deliberately small, whitespace-separated Patchbay text format. */
export function parse(src: string): ParseResult {
  const errors: ParseError[] = [];
  const lines: SourceLine[] = src.split(/\r?\n/).flatMap((raw, index) => {
    const text = raw.split('#', 1)[0]?.replace(/^[\s\p{White_Space}]+|[\s\p{White_Space}]+$/gu, '') ?? '';
    return text ? [{ line: index + 1, tokens: text.split(/[\s\p{White_Space}]+/u) }] : [];
  });
  const error = (line: number, msg: string) => errors.push({ line, msg });
  let kind: 'mealy' | 'moore' | undefined;
  let start: string | undefined;
  let startLine = 1;
  let typeSeen = false;
  let startSeen = false;
  let alphabetSeen = false;
  const alphabet = new Set<string>();

  for (const { line, tokens } of lines) {
    if (tokens[0] === 'type') {
      if (typeSeen) {
        error(line, 'The machine type is already declared. Keep one type line.');
        continue;
      }
      typeSeen = true;
      if (tokens.length !== 2 || !['mealy', 'moore'].includes(tokens[1] ?? '')) {
        error(line, 'Use "type mealy" or "type moore".');
      } else {
        kind = tokens[1] as 'mealy' | 'moore';
      }
    } else if (tokens[0] === 'start') {
      if (startSeen) {
        error(line, 'The start state is already declared. Keep one start line.');
        continue;
      }
      startSeen = true;
      startLine = line;
      if (tokens.length !== 2) error(line, 'Use "start" followed by one state name.');
      else start = tokens[1];
    } else if (tokens[0] === 'alphabet') {
      if (alphabetSeen) {
        error(line, 'The input alphabet is already declared. Keep one alphabet line.');
        continue;
      }
      alphabetSeen = true;
      for (const symbol of tokens.slice(1)) {
        if (!isSymbol(symbol)) error(line, `Input "${symbol}" must be a nonempty Unicode token without whitespace or #.`);
        else if (alphabet.has(symbol)) error(line, `Input "${symbol}" is already in the alphabet. Keep each symbol once.`);
        else alphabet.add(symbol);
      }
    }
  }

  if (!typeSeen) error(1, 'Declare the machine type with "type mealy" or "type moore".');
  if (!startSeen) error(1, 'Declare a start state with "start A".');
  if (!kind) return { errors: errors.sort((a, b) => a.line - b.line) };

  const stateLines = new Map<string, number>();
  const delta = record<Record<string, string>>();
  const mealyOutputs = record<Record<string, string>>();
  const mooreOutputs = record<string>();
  const state = (name: string, line: number) => {
    if (['type', 'start', 'out', 'state', 'alphabet'].includes(name)) {
      error(line, `"${name}" is a reserved keyword. Choose another state name.`);
      return;
    }
    if (!isSymbol(name)) {
      error(line, 'Choose a state name containing valid Unicode without whitespace or #.');
      return;
    }
    if (!stateLines.has(name)) stateLines.set(name, line);
    delta[name] ??= record<string>();
    mealyOutputs[name] ??= record<string>();
  };

  // Explicit declarations preserve display order even when transitions occur first.
  const declaredStates = new Set<string>();
  for (const { line, tokens } of lines) {
    if (tokens[0] !== 'state') continue;
    if (tokens.length !== 2) {
      error(line, 'Use "state" followed by one state name.');
      continue;
    }
    const name = tokens[1]!;
    if (declaredStates.has(name)) error(line, `State ${name} is already declared. Keep one state line per state.`);
    else { declaredStates.add(name); state(name, line); }
  }

  for (const { line, tokens } of lines) {
    const keyword = tokens[0];
    if (keyword === 'type' || keyword === 'start' || keyword === 'state' || keyword === 'alphabet') continue;
    if (keyword === 'out') {
      if (kind !== 'moore') {
        error(line, 'Mealy outputs belong on transitions. Remove the out line.');
        continue;
      }
      if (tokens.length !== 3) {
        error(line, 'A Moore output line has the form "out A 0".');
        continue;
      }
      const name = tokens[1]!;
      const output = tokens[2]!;
      state(name, line);
      if (!isSymbol(output)) {
        error(line, `The output for state ${name} must be a nonempty Unicode token without whitespace or #.`);
      } else if (own(mooreOutputs, name) !== undefined) {
        error(line, `State ${name} already has an output. Keep one out line per state.`);
      } else {
        mooreOutputs[name] = output;
      }
      continue;
    }

    const expectedLength = kind === 'mealy' ? 4 : 3;
    if (tokens.length !== expectedLength) {
      error(line, kind === 'mealy'
        ? 'A Mealy transition needs four values: from, input, to, output.'
        : 'A Moore transition needs three values: from, input, to.');
      continue;
    }
    const [from, sym, to, output] = tokens as [string, string, string, string?];
    state(from, line);
    state(to, line);
    if (!stateLines.has(from) || !stateLines.has(to)) continue;
    if (!isSymbol(sym)) {
      error(line, `Input "${sym}" must be a nonempty Unicode token without whitespace or #.`);
      continue;
    }
    if (alphabetSeen && !alphabet.has(sym)) {
      error(line, `Input "${sym}" is not in the declared alphabet. Add it to the alphabet line first.`);
      continue;
    }
    if (!alphabetSeen) alphabet.add(sym);
    if (own(delta[from], sym) !== undefined) {
      error(line, `State ${from} already has a transition for "${sym}".`);
      continue;
    }
    delta[from]![sym] = to;
    if (kind === 'mealy') {
      if (output === undefined || !isSymbol(output)) {
        error(line, 'A transition output must be a nonempty Unicode token without whitespace or #.');
      } else {
        mealyOutputs[from]![sym] = output;
      }
    }
  }

  if (start !== undefined && !stateLines.has(start)) {
    error(startLine, `Start state ${start} does not exist. Add its transitions first.`);
  }
  if (alphabet.size === 0) error(1, 'Declare at least one input symbol with "alphabet a b", or add a transition.');
  for (const [name, line] of stateLines) {
    for (const sym of alphabet) {
      if (own(delta[name], sym) === undefined) {
        error(line, `State ${name} has no transition for "${sym}". Add one for every input symbol.`);
      }
    }
    if (kind === 'moore' && own(mooreOutputs, name) === undefined) {
      error(line, `State ${name} has no output. Add "out ${name} 0" with the output you want.`);
    }
  }

  errors.sort((a, b) => a.line - b.line);
  if (errors.length || start === undefined) return { errors };
  const machine: MachineDef = {
    states: [...stateLines.keys()],
    alphabet: [...alphabet],
    start,
    delta,
    outputs: kind === 'mealy'
      ? { kind, lambda: mealyOutputs }
      : { kind, lambda: mooreOutputs },
  };
  return { machine, errors };
}
