import { buildDiagram } from '../diagram/layout';
import { parse } from '../engine/parse';
import { serialize } from '../engine/serialize';
import { isSymbol } from '../engine/symbols';
import { own, record, type MachineDef } from '../engine/types';

export type GraphKind = 'mealy' | 'moore';
export interface GraphState { id: string; name: string; output: string; x: number; y: number }
export interface GraphTransition { id: string; from: string; to: string; input: string; output: string }
export interface GraphDraft {
  kind: GraphKind;
  states: GraphState[];
  transitions: GraphTransition[];
  alphabet: string[];
  start: string;
  nextId: number;
}

const reservedNames = new Set(['type', 'start', 'out', 'state', 'alphabet']);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isName = (value: unknown): value is string => isSymbol(value) && !reservedNames.has(value);
const pairKey = (from: string, input: string) => JSON.stringify([from, input]);

function assertName(name: string): void {
  if (reservedNames.has(name)) throw new Error(`"${name}" is a reserved keyword. Choose another state name.`);
  if (!isName(name)) throw new Error('Choose a nonempty state name without whitespace or #.');
}

function assertSymbol(value: string, label: string, allowEmpty = false): void {
  if (!(allowEmpty && value === '') && !isSymbol(value)) {
    throw new Error(`${label} must be one nonempty Unicode token without whitespace or #.`);
  }
}

function usedIds(draft: GraphDraft): Set<string> {
  return new Set([...draft.states.map(state => state.id), ...draft.transitions.map(edge => edge.id)]);
}

function allocateId(draft: GraphDraft, prefix: 's' | 't', used = usedIds(draft)): string {
  if (!Number.isSafeInteger(draft.nextId) || draft.nextId < 0) throw new Error('The draft id counter is invalid.');
  let id: string;
  do {
    if (draft.nextId >= Number.MAX_SAFE_INTEGER) throw new Error('The draft id counter has no safe ids remaining.');
    id = `${prefix}${draft.nextId++}`;
  } while (used.has(id));
  used.add(id);
  return id;
}

function findState(draft: GraphDraft, id: string): GraphState {
  const state = draft.states.find(state => state.id === id);
  if (!state) throw new Error('That state does not exist in this draft. Select an existing state.');
  return state;
}

/** Incomplete drafts are editing data; no behavior is invented by creating one. */
export function createDraft(kind: GraphKind = 'mealy'): GraphDraft {
  if (kind !== 'mealy' && kind !== 'moore') throw new Error('Choose a Mealy or Moore machine.');
  return { kind, states: [], transitions: [], alphabet: [], start: '', nextId: 0 };
}

export function cloneDraft(draft: GraphDraft): GraphDraft {
  return {
    kind: draft.kind, start: draft.start, nextId: draft.nextId, alphabet: [...draft.alphabet],
    states: draft.states.map(({ id, name, output, x, y }) => ({ id, name, output, x, y })),
    transitions: draft.transitions.map(({ id, from, to, input, output }) => ({ id, from, to, input, output })),
  };
}

export function addState(draft: GraphDraft, x: number, y: number, name?: string): GraphState {
  if (!isCoordinate(x) || !isCoordinate(y)) throw new Error('State coordinates must be finite and nonnegative.');
  const names = new Set(draft.states.map(state => state.name));
  if (name === undefined) {
    let index = 0;
    while (names.has(`q${index}`)) index++;
    name = `q${index}`;
  }
  assertName(name);
  if (names.has(name)) throw new Error(`State ${name} already exists. Choose a unique state name.`);
  const state: GraphState = { id: allocateId(draft, 's'), name, output: '0', x, y };
  draft.states.push(state);
  if (draft.states.length === 1) draft.start = state.id;
  return state;
}

export function renameState(draft: GraphDraft, id: string, name: string): void {
  const state = findState(draft, id);
  assertName(name);
  if (draft.states.some(other => other.id !== id && other.name === name)) {
    throw new Error(`State ${name} already exists. Choose a unique state name.`);
  }
  state.name = name;
}

export function removeState(draft: GraphDraft, id: string): void {
  findState(draft, id);
  draft.states = draft.states.filter(state => state.id !== id);
  draft.transitions = draft.transitions.filter(edge => edge.from !== id && edge.to !== id);
  if (draft.start === id) draft.start = draft.states[0]?.id ?? '';
}

/** An id identifies an explicit edit; an omitted id always creates a new edge. */
export function upsertTransition(
  draft: GraphDraft, transition: Omit<GraphTransition, 'id'> & { id?: string },
): GraphTransition {
  findState(draft, transition.from);
  findState(draft, transition.to);
  assertSymbol(transition.input, 'Input');
  assertSymbol(transition.output, 'Transition output', true);
  const existing = transition.id === undefined ? undefined : draft.transitions.find(edge => edge.id === transition.id);
  if (transition.id !== undefined && !existing) throw new Error('That transition does not exist. Select an existing edge to edit.');
  if (draft.transitions.some(edge => edge.id !== existing?.id && edge.from === transition.from && edge.input === transition.input)) {
    throw new Error(`State ${findState(draft, transition.from).name} already has a transition for "${transition.input}". Edit that edge instead.`);
  }
  const edge: GraphTransition = {
    id: existing?.id ?? allocateId(draft, 't'), from: transition.from,
    to: transition.to, input: transition.input, output: transition.output,
  };
  if (existing) Object.assign(existing, edge);
  else draft.transitions.push(edge);
  if (!draft.alphabet.includes(edge.input)) draft.alphabet.push(edge.input);
  return existing ?? edge;
}

export function removeTransition(draft: GraphDraft, id: string): void {
  if (!draft.transitions.some(edge => edge.id === id)) throw new Error('That transition does not exist. Select an existing edge.');
  draft.transitions = draft.transitions.filter(edge => edge.id !== id);
}

/** Removing an input explicitly removes its edges, retaining all other edits. */
export function setAlphabet(draft: GraphDraft, symbols: string[]): void {
  const alphabet = new Set<string>();
  for (const symbol of symbols) {
    assertSymbol(symbol, 'Input');
    if (alphabet.has(symbol)) throw new Error(`Input "${symbol}" is already in the alphabet. Keep each symbol once.`);
    alphabet.add(symbol);
  }
  draft.alphabet = [...alphabet];
  draft.transitions = draft.transitions.filter(edge => alphabet.has(edge.input));
}

export function fillMissing(draft: GraphDraft, output = '0'): void {
  assertStructure(draft);
  assertSymbol(output, 'Transition output');
  const pairs = new Set(draft.transitions.map(edge => pairKey(edge.from, edge.input)));
  const ids = usedIds(draft);
  for (const state of draft.states) {
    for (const input of draft.alphabet) {
      if (pairs.has(pairKey(state.id, input))) continue;
      draft.transitions.push({ id: allocateId(draft, 't', ids), from: state.id, to: state.id, input, output });
    }
  }
}

function checkFields(value: Record<string, unknown>, keys: string[], path: string, errors: string[]): void {
  const permitted = new Set(keys);
  for (const key of Object.keys(value)) if (!permitted.has(key)) errors.push(`${path} has an unexpected field "${key}".`);
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path} is missing its "${key}" field.`);
}

/** Import validation deliberately permits absent start/outputs/edges, never corrupt references. */
function structureErrors(value: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(value)) return ['The graph draft must be an object.'];
  checkFields(value, ['kind', 'states', 'transitions', 'alphabet', 'start', 'nextId'], 'Draft', errors);
  if (value.kind !== 'mealy' && value.kind !== 'moore') errors.push('The draft kind must be mealy or moore.');
  if (!Number.isSafeInteger(value.nextId) || (value.nextId as number) < 0) errors.push('The draft nextId must be a nonnegative safe integer.');
  if (!Array.isArray(value.states)) errors.push('Draft states must be an array.');
  if (!Array.isArray(value.transitions)) errors.push('Draft transitions must be an array.');
  if (!Array.isArray(value.alphabet)) errors.push('The input alphabet must be an array.');
  const ids = new Set<string>(), stateIds = new Set<string>(), names = new Set<string>(), alphabet = new Set<string>();
  for (const [index, state] of (Array.isArray(value.states) ? value.states : []).entries()) {
    const path = `State ${index + 1}`;
    if (!isObject(state)) { errors.push(`${path} must be an object.`); continue; }
    checkFields(state, ['id', 'name', 'output', 'x', 'y'], path, errors);
    if (!isId(state.id)) errors.push(`${path} needs a nonempty id.`);
    else {
      if (ids.has(state.id)) errors.push(`${path} has a duplicate id "${state.id}".`);
      ids.add(state.id); stateIds.add(state.id);
    }
    if (!isName(state.name)) errors.push(`${path} needs a nonempty, unreserved name without whitespace or #.`);
    else { if (names.has(state.name)) errors.push(`State name ${state.name} is duplicated.`); names.add(state.name); }
    if (!(state.output === '' || isSymbol(state.output))) errors.push(`${path} output must be empty or one nonempty Unicode token without whitespace or #.`);
    if (!isCoordinate(state.x) || !isCoordinate(state.y)) errors.push(`${path} coordinates must be finite and nonnegative.`);
  }
  for (const symbol of Array.isArray(value.alphabet) ? value.alphabet : []) {
    if (!isSymbol(symbol)) errors.push('Each input alphabet entry must be one nonempty Unicode token without whitespace or #.');
    else { if (alphabet.has(symbol)) errors.push(`Input "${symbol}" is duplicated in the alphabet.`); alphabet.add(symbol); }
  }
  if (typeof value.start !== 'string') errors.push('The start state must be an id or an empty string.');
  else if (value.start !== '' && !stateIds.has(value.start)) errors.push('The start state references an unknown state.');
  const pairs = new Set<string>();
  for (const [index, edge] of (Array.isArray(value.transitions) ? value.transitions : []).entries()) {
    const path = `Transition ${index + 1}`;
    if (!isObject(edge)) { errors.push(`${path} must be an object.`); continue; }
    checkFields(edge, ['id', 'from', 'to', 'input', 'output'], path, errors);
    if (!isId(edge.id)) errors.push(`${path} needs a nonempty id.`);
    else { if (ids.has(edge.id)) errors.push(`${path} has a duplicate id "${edge.id}".`); ids.add(edge.id); }
    if (typeof edge.from !== 'string' || !stateIds.has(edge.from)) errors.push(`${path} references an unknown source state.`);
    if (typeof edge.to !== 'string' || !stateIds.has(edge.to)) errors.push(`${path} references an unknown destination state.`);
    if (!isSymbol(edge.input)) errors.push(`${path} input must be one nonempty Unicode token without whitespace or #.`);
    else if (!alphabet.has(edge.input)) errors.push(`${path} input "${edge.input}" is not in the alphabet.`);
    if (!(edge.output === '' || isSymbol(edge.output))) errors.push(`${path} output must be empty or one nonempty Unicode token without whitespace or #.`);
    if (typeof edge.from === 'string' && typeof edge.input === 'string') {
      const pair = pairKey(edge.from, edge.input);
      if (pairs.has(pair)) errors.push(`${path} duplicates a state/input pair. Keep one transition per state/input.`);
      pairs.add(pair);
    }
  }
  return errors;
}

function assertStructure(draft: unknown): asserts draft is GraphDraft {
  const errors = structureErrors(draft);
  if (errors.length) throw new Error(errors.join('\n'));
}

export function validateDraft(draft: GraphDraft): string[] {
  const errors = structureErrors(draft);
  if (errors.length) return errors;
  if (draft.states.length === 0) errors.push('Add at least one state.');
  if (draft.alphabet.length === 0) errors.push('Add at least one input symbol to the alphabet.');
  if (draft.start === '') errors.push('Choose a start state.');
  const pairs = new Set(draft.transitions.map(edge => pairKey(edge.from, edge.input)));
  for (const state of draft.states) {
    for (const input of draft.alphabet) {
      if (!pairs.has(pairKey(state.id, input))) errors.push(`State ${state.name} has no transition for "${input}". Connect a target or fill missing self-loops.`);
    }
    if (draft.kind === 'moore' && !isSymbol(state.output)) errors.push(`State ${state.name} needs one output token.`);
  }
  if (draft.kind === 'mealy') {
    const names = new Map(draft.states.map(state => [state.id, state.name]));
    for (const edge of draft.transitions) {
      if (!isSymbol(edge.output)) errors.push(`The transition from ${names.get(edge.from)} for "${edge.input}" needs one output token.`);
    }
  }
  return errors;
}

function machineFromDraft(draft: GraphDraft): MachineDef {
  const names = new Map(draft.states.map(state => [state.id, state.name]));
  const delta = record<Record<string, string>>();
  const mealyOutputs = record<Record<string, string>>(), mooreOutputs = record<string>();
  for (const state of draft.states) {
    delta[state.name] = record<string>();
    mealyOutputs[state.name] = record<string>();
    if (state.output !== '') mooreOutputs[state.name] = state.output;
  }
  for (const edge of draft.transitions) {
    const from = names.get(edge.from)!;
    delta[from]![edge.input] = names.get(edge.to)!;
    if (edge.output !== '') mealyOutputs[from]![edge.input] = edge.output;
  }
  return {
    states: draft.states.map(state => state.name), alphabet: [...draft.alphabet],
    start: names.get(draft.start) ?? '', delta,
    outputs: draft.kind === 'mealy' ? { kind: 'mealy', lambda: mealyOutputs } : { kind: 'moore', lambda: mooreOutputs },
  };
}

export function draftToMachine(draft: GraphDraft): MachineDef {
  const errors = validateDraft(draft);
  if (errors.length) throw new Error(errors.join('\n'));
  return machineFromDraft(draft);
}

/** Text retains isolated state/alphabet declarations; use graph files to save all unfinished edits. */
export function draftToSource(draft: GraphDraft): string {
  assertStructure(draft);
  return serialize(machineFromDraft(draft));
}

export function draftFromMachine(machine: MachineDef, positions?: Record<string, { x: number; y: number }>): GraphDraft {
  const draft = createDraft(machine.outputs.kind);
  draft.alphabet = [...machine.alphabet];
  const nodes = new Map(buildDiagram(machine, { w: 800, h: 440 }).nodes.map(node => [node.id, node]));
  const names = new Map<string, string>(), ids = new Set<string>();
  for (const name of machine.states) {
    assertName(name);
    const saved = own(positions, name), node = nodes.get(name)!;
    const position = saved && isCoordinate(saved.x) && isCoordinate(saved.y) ? saved : node;
    const state: GraphState = {
      id: allocateId(draft, 's', ids), name, x: position.x, y: position.y,
      output: machine.outputs.kind === 'moore' ? own(machine.outputs.lambda, name) ?? '' : '0',
    };
    draft.states.push(state); names.set(name, state.id);
  }
  const start = names.get(machine.start);
  if (start === undefined) throw new Error('The machine start state does not exist.');
  draft.start = start;
  for (const from of machine.states) {
    for (const input of machine.alphabet) {
      const to = own(own(machine.delta, from), input);
      if (to === undefined) continue;
      if (!names.has(to)) throw new Error(`Transition from ${from} references unknown state ${to}.`);
      draft.transitions.push({
        id: allocateId(draft, 't', ids), from: names.get(from)!, to: names.get(to)!, input,
        output: machine.outputs.kind === 'mealy' ? own(own(machine.outputs.lambda, from), input) ?? '' : '0',
      });
    }
  }
  assertStructure(draft);
  return draft;
}

export function serializeDraft(draft: GraphDraft): string {
  assertStructure(draft);
  return `${JSON.stringify({ format: 'patchbay-graph', version: 1, draft: cloneDraft(draft) }, null, 2)}\n`;
}

export function parseDraft(source: string): GraphDraft {
  if (/^[\s\uFEFF]*[\[{]/.test(source)) {
    let wrapper: unknown;
    try { wrapper = JSON.parse(source.replace(/^\uFEFF/, '')); }
    catch { throw new Error('The graph file is not valid JSON.'); }
    if (!isObject(wrapper)) throw new Error('The graph file must contain a versioned graph object.');
    const errors: string[] = [];
    checkFields(wrapper, ['format', 'version', 'draft'], 'Graph file', errors);
    if (wrapper.format !== 'patchbay-graph' || wrapper.version !== 1) errors.push('Use a patchbay-graph file with version 1.');
    if (errors.length) throw new Error(errors.join('\n'));
    assertStructure(wrapper.draft);
    return cloneDraft(wrapper.draft);
  }
  const result = parse(source);
  if (!result.machine) throw new Error(result.errors.map(error => `Line ${error.line}: ${error.msg}`).join('\n'));
  return draftFromMachine(result.machine);
}
