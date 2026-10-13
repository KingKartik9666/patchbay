import { own, type MachineDef, type Trace } from './types';
import { joinSymbols, tokenizeInput } from './symbols';
export { joinSymbols, tokenizeInput, usesTokenInput } from './symbols';

/** Indexes count input symbols, including whole tokens, like the trace cursor. */
export function checkInput(m: MachineDef, input: string): { index: number; sym: string }[] {
  const alphabet = new Set(m.alphabet);
  return tokenizeInput(m, input).flatMap((sym, index) => alphabet.has(sym) ? [] : [{ index, sym }]);
}

/** Missing transitions or outputs halt cleanly and preserve the completed prefix. */
export function simulate(m: MachineDef, input: string, opts?: { mooreInitial?: boolean }): Trace {
  const trace: Trace = { steps: [], output: '' };
  const symbols = tokenizeInput(m, input);
  const outputSymbols: string[] = [];
  const alphabet = new Set(m.alphabet);
  const states = new Set(m.states);
  let current = m.start;

  if (m.outputs.kind === 'moore' && opts?.mooreInitial !== false) {
    const initial = own(m.outputs.lambda, current);
    if (initial === undefined) {
      trace.fault = { at: 0, state: current, sym: symbols[0] ?? '' };
      return trace;
    }
    trace.initialOut = initial;
    outputSymbols.push(initial);
  }

  for (const [i, sym] of symbols.entries()) {
    const to = own(own(m.delta, current), sym);
    if (!alphabet.has(sym) || !states.has(current) || to === undefined || !states.has(to)) {
      trace.fault = { at: i, state: current, sym };
      break;
    }
    const out = m.outputs.kind === 'mealy'
      ? own(own(m.outputs.lambda, current), sym)
      : own(m.outputs.lambda, to);
    if (out === undefined) {
      trace.fault = { at: i, state: current, sym };
      break;
    }
    trace.steps.push({ i, from: current, sym, to, out });
    outputSymbols.push(out);
    current = to;
  }
  trace.output = joinSymbols(m, outputSymbols);
  return trace;
}
