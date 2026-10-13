import { own, record, type MachineDef } from './types';
import { isSymbol } from './symbols';

/** The destination state's output becomes the transition's output. */
export function mooreToMealy(m: MachineDef): MachineDef {
  if (m.outputs.kind !== 'moore') throw new Error('Choose a Moore machine to convert to Mealy.');
  const delta = record<Record<string, string>>();
  const lambda = record<Record<string, string>>();
  for (const state of m.states) {
    delta[state] = record<string>();
    lambda[state] = record<string>();
    for (const sym of m.alphabet) {
      const to = own(own(m.delta, state), sym);
      if (to === undefined) continue;
      const out = own(m.outputs.lambda, to);
      if (out === undefined) throw new Error(`State ${to} needs an output before conversion.`);
      delta[state]![sym] = to;
      lambda[state]![sym] = out;
    }
  }
  return {
    states: [...m.states], alphabet: [...m.alphabet], start: m.start,
    delta, outputs: { kind: 'mealy', lambda },
  };
}

/**
 * Split each state by its incoming output. A new Initial state supplies the
 * chosen initialOutput (default 0), which has no Mealy counterpart. With
 * mooreInitial:false, the result prints exactly the original Mealy output.
 */
export function mealyToMoore(m: MachineDef, initialOutput = '0'): MachineDef {
  if (m.outputs.kind !== 'mealy') throw new Error('Choose a Mealy machine to convert to Moore.');
  if (!isSymbol(initialOutput)) {
    throw new Error('The initial Moore output must be a nonempty Unicode token without whitespace or #.');
  }
  const pairs = new Map<string, { name: string; original: string; output: string }>();
  const key = (state: string, output: string) => JSON.stringify([state, output]);
  for (const from of m.states) {
    for (const sym of m.alphabet) {
      const to = own(own(m.delta, from), sym);
      const output = own(own(m.outputs.lambda, from), sym);
      if (to === undefined || output === undefined) continue;
      const id = key(to, output);
      if (!pairs.has(id)) pairs.set(id, { name: `Q${pairs.size}_${to}`, original: to, output });
    }
  }

  const delta = record<Record<string, string>>();
  const lambda = record<string>();
  const allStates = [{ name: 'Initial', original: m.start, output: initialOutput }, ...pairs.values()];
  for (const state of allStates) {
    delta[state.name] = record<string>();
    lambda[state.name] = state.output;
    for (const sym of m.alphabet) {
      const to = own(own(m.delta, state.original), sym);
      const output = own(own(m.outputs.lambda, state.original), sym);
      if (to === undefined || output === undefined) continue;
      const destination = pairs.get(key(to, output));
      if (destination) delta[state.name]![sym] = destination.name;
    }
  }
  return {
    states: allStates.map(({ name }) => name), alphabet: [...m.alphabet], start: 'Initial',
    delta, outputs: { kind: 'moore', lambda },
  };
}
