import { describe, expect, it } from 'vitest';
import { parse } from '../src/engine/parse';
import { serialize } from '../src/engine/serialize';
import { simulate } from '../src/engine/simulate';
import { record, type MachineDef } from '../src/engine/types';
import {
  addState, cloneDraft, createDraft, draftFromMachine, draftToMachine, draftToSource,
  fillMissing, parseDraft, removeState, removeTransition, renameState, serializeDraft,
  setAlphabet, upsertTransition, validateDraft, type GraphDraft,
} from '../src/editor/model';

describe('explicit machine declarations', () => {
  it('preserves declared state and nonbinary alphabet order independently of edge order', () => {
    const result = parse(`type mealy
start B
state B
state A
alphabet λ c b a
A a A 1
A b B 0
A c A 🙂
A λ B ✨
B a A 1
B b B 0
B c A 🙂
B λ B ✨`);
    expect(result.errors).toEqual([]);
    expect(result.machine?.states).toEqual(['B', 'A']);
    expect(result.machine?.alphabet).toEqual(['λ', 'c', 'b', 'a']);
    expect(simulate(result.machine!, 'abcλ').output).toBe('10🙂✨');
  });

  it('reports missing edges for explicitly declared isolated states', () => {
    const result = parse('type mealy\nstart A\nstate A\nstate Lonely\nalphabet a b\nA a A 0\nA b A 1');
    expect(result.machine).toBeUndefined();
    expect(result.errors).toEqual([
      { line: 4, msg: expect.stringContaining('State Lonely has no transition for "a"') },
      { line: 4, msg: expect.stringContaining('State Lonely has no transition for "b"') },
    ]);
  });

  it('honors declarations after edges and rejects state names that cannot round trip through UTF-8', () => {
    const result = parse('type mealy\nstart B\nA a B 0\nB a A 1\nstate B\nstate A\nalphabet a');
    expect(result.errors).toEqual([]);
    expect(result.machine?.states).toEqual(['B', 'A']);
    expect(parse('type mealy\nstart \ud800\nstate \ud800\nalphabet a\n\ud800 a \ud800 0').machine).toBeUndefined();
  });

  it('rejects repeated declarations and inputs outside the explicit alphabet', () => {
    const repeated = parse('type mealy\nstart A\nstate A\nstate A\nalphabet a a\nalphabet b\nA a A 0');
    expect(repeated.machine).toBeUndefined();
    expect(repeated.errors).toContainEqual({ line: 4, msg: expect.stringContaining('already declared') });
    expect(repeated.errors).toContainEqual({ line: 5, msg: expect.stringContaining('already') });
    expect(repeated.errors).toContainEqual({ line: 6, msg: expect.stringContaining('already declared') });
    const outside = parse('type mealy\nstart A\nstate A\nalphabet a\nA a A 0\nA b A 1');
    expect(outside.machine).toBeUndefined();
    expect(outside.errors).toContainEqual({ line: 6, msg: expect.stringContaining('alphabet') });
  });

  it('serializes declarations so machine order does not change in a round trip', () => {
    const delta = record<Record<string, string>>();
    const lambda = record<Record<string, string>>();
    for (const name of ['B', 'A']) {
      delta[name] = record<string>();
      lambda[name] = record<string>();
      delta[name]!.b = 'A'; delta[name]!.a = 'B';
      lambda[name]!.b = '0'; lambda[name]!.a = '1';
    }
    const original: MachineDef = {
      states: ['B', 'A'], alphabet: ['b', 'a'], start: 'B', delta,
      outputs: { kind: 'mealy', lambda },
    };
    const source = serialize(original);
    expect(source).toContain('state B\nstate A\n');
    expect(source).toContain('alphabet b a\n');
    const restored = parse(source);
    expect(restored.errors).toEqual([]);
    expect(restored.machine).toEqual(original);
  });
});

function twoStates(kind: 'mealy' | 'moore' = 'mealy'): GraphDraft {
  const draft = createDraft(kind);
  addState(draft, 0, 0, 'A');
  addState(draft, 200, 120, 'B');
  return draft;
}

describe('graph draft edits', () => {
  it('keeps an empty draft editable and saveable while reporting what Run requires', () => {
    const draft = createDraft();
    expect(draft.states).toEqual([]);
    expect(draft.alphabet).toEqual([]);
    expect(draft.start).toBe('');
    expect(validateDraft(draft)).toEqual(expect.arrayContaining([
      expect.stringMatching(/state/i), expect.stringMatching(/alphabet/i),
    ]));
    expect(() => draftToMachine(draft)).toThrow(/state/i);
    expect(parseDraft(serializeDraft(draft))).toEqual(draft);
    expect(createDraft('moore').kind).toBe('moore');
  });

  it('chooses unique names and a first start state without reusing removed ids', () => {
    const draft = createDraft();
    const first = addState(draft, 0, 0);
    const second = addState(draft, 100, 0, 'q1');
    const third = addState(draft, 200, 0);
    expect([first.name, second.name, third.name]).toEqual(['q0', 'q1', 'q2']);
    expect(draft.start).toBe(first.id);
    removeState(draft, first.id);
    expect(draft.start).toBe(second.id);
    expect(addState(draft, 300, 0).id).not.toBe(first.id);
    expect(new Set(draft.states.map(state => state.id)).size).toBe(3);
  });

  it.each([NaN, Infinity, -1])('rejects invalid coordinates %s before adding a state', (coordinate) => {
    const draft = createDraft();
    expect(() => addState(draft, coordinate, 0)).toThrow(/position|coordinate/i);
    expect(() => addState(draft, 0, coordinate)).toThrow(/position|coordinate/i);
    expect(draft.states).toEqual([]);
    expect(draft.nextId).toBe(0);
  });

  it.each(['', 'Bad name', 'Bad#name', 'type', 'start', 'out', 'state', 'alphabet'])('rejects invalid state name %j without partial edits', (name) => {
    const draft = twoStates();
    const before = cloneDraft(draft);
    expect(() => renameState(draft, draft.states[0]!.id, name)).toThrow();
    expect(() => addState(draft, 0, 0, name)).toThrow();
    expect(draft).toEqual(before);
  });

  it('renames by stable id, retaining start choice and transition behavior', () => {
    const draft = twoStates();
    const [a, b] = draft.states;
    upsertTransition(draft, { from: a!.id, to: b!.id, input: 'a', output: '1' });
    upsertTransition(draft, { from: b!.id, to: a!.id, input: 'a', output: '0' });
    draft.start = b!.id;
    renameState(draft, a!.id, '__proto__');
    expect(draft.transitions[0]!.to).toBe(b!.id);
    expect(draft.transitions[1]!.to).toBe(a!.id);
    expect(draftToMachine(draft).start).toBe('B');
    expect(simulate(draftToMachine(draft), 'aaa').output).toBe('010');
    expect(() => renameState(draft, a!.id, 'B')).toThrow(/already|unique/i);
  });

  it('requires an existing id to update an edge and rejects conflicting state/input pairs atomically', () => {
    const draft = twoStates();
    const [a, b] = draft.states;
    const edge = upsertTransition(draft, { from: a!.id, to: b!.id, input: 'a', output: '1' });
    expect(draft.alphabet).toEqual(['a']);
    const before = cloneDraft(draft);
    expect(() => upsertTransition(draft, { from: a!.id, to: a!.id, input: 'a', output: '0' })).toThrow(/already|duplicate/i);
    expect(() => upsertTransition(draft, { id: 'missing', from: a!.id, to: b!.id, input: 'b', output: '0' })).toThrow(/exist|unknown/i);
    expect(draft).toEqual(before);
    const updated = upsertTransition(draft, { id: edge.id, from: a!.id, to: a!.id, input: 'a', output: '✨' });
    expect(updated).toEqual({ id: edge.id, from: a!.id, to: a!.id, input: 'a', output: '✨' });
    const other = upsertTransition(draft, { from: b!.id, to: a!.id, input: 'b', output: '0' });
    expect(() => upsertTransition(draft, { id: other.id, from: a!.id, to: b!.id, input: 'a', output: '0' })).toThrow(/already|duplicate/i);
    expect(draft.transitions).toHaveLength(2);
  });

  it.each(['', 'a b', ' ', '#', '\ud800', 'a\u0085b'])('rejects invalid transition input %j without changing the alphabet', (input) => {
    const draft = twoStates();
    expect(() => upsertTransition(draft, { from: draft.start, to: draft.start, input, output: '0' })).toThrow(/token/i);
    expect(draft.alphabet).toEqual([]);
    expect(draft.transitions).toEqual([]);
  });

  it.each(['bad output', '#', '\ud800', 'a\u0085b'])('rejects invalid output tokens %j without changing the draft', (output) => {
    const draft = twoStates();
    const before = cloneDraft(draft);
    expect(() => upsertTransition(draft, { from: draft.start, to: draft.start, input: 'coin', output })).toThrow(/token/i);
    expect(draft).toEqual(before);
  });

  it('lists every missing state/input pair and only fills edges on explicit request', () => {
    const draft = twoStates();
    setAlphabet(draft, ['a', 'λ']);
    const [a, b] = draft.states;
    const original = upsertTransition(draft, { from: a!.id, to: b!.id, input: 'a', output: '1' });
    expect(validateDraft(draft)).toEqual([
      expect.stringContaining('A'), expect.stringContaining('B'), expect.stringContaining('B'),
    ]);
    expect(validateDraft(draft).join('\n')).toContain('"λ"');
    expect(draft.transitions).toHaveLength(1);
    fillMissing(draft, '🙂');
    expect(validateDraft(draft)).toEqual([]);
    expect(draft.transitions).toHaveLength(4);
    expect(draft.transitions.find(edge => edge.id === original.id)).toEqual(original);
    expect(draft.transitions.filter(edge => edge.id !== original.id).every(edge => edge.from === edge.to && edge.output === '🙂')).toBe(true);
    expect(simulate(draftToMachine(draft), 'aλa').output).toBe('1🙂🙂');
    fillMissing(draft);
    expect(draft.transitions).toHaveLength(4);
  });

  it('defaults filled edge outputs to 0 and leaves missing Moore state outputs actionable', () => {
    const draft = twoStates('moore');
    const [a, b] = draft.states;
    a!.output = 'λ'; b!.output = '';
    setAlphabet(draft, ['a']);
    fillMissing(draft);
    expect(draft.transitions.every(edge => edge.output === '0')).toBe(true);
    expect(validateDraft(draft)).toEqual([expect.stringMatching(/B.*output/i)]);
    b!.output = '🙂';
    draft.start = b!.id;
    expect(simulate(draftToMachine(draft), 'aa').output).toBe('🙂🙂🙂');
  });

  it('allows an unfinished Mealy output in a draft but refuses to run it', () => {
    const draft = createDraft();
    const a = addState(draft, 0, 0, 'A');
    upsertTransition(draft, { from: a.id, to: a.id, input: 'a', output: '' });
    expect(validateDraft(draft)).toEqual([expect.stringMatching(/output/i)]);
    expect(() => draftToMachine(draft)).toThrow(/output/i);
    expect(parseDraft(serializeDraft(draft))).toEqual(draft);
    expect(draftToSource(draft)).toContain('A a A\n');
  });

  it('deletes all incident edges and moves a deleted start to the next state', () => {
    const draft = twoStates();
    const [a, b] = draft.states;
    upsertTransition(draft, { from: a!.id, to: b!.id, input: 'a', output: '1' });
    upsertTransition(draft, { from: b!.id, to: a!.id, input: 'a', output: '0' });
    const keep = upsertTransition(draft, { from: b!.id, to: b!.id, input: 'b', output: '0' });
    removeState(draft, a!.id);
    expect(draft.transitions).toEqual([keep]);
    expect(draft.start).toBe(b!.id);
    removeTransition(draft, keep.id);
    expect(draft.transitions).toEqual([]);
    removeState(draft, b!.id);
    expect(draft.start).toBe('');
  });

  it('removes deleted alphabet symbols and keeps a copied, explicitly ordered alphabet', () => {
    const draft = twoStates();
    setAlphabet(draft, ['a', 'b']);
    fillMissing(draft);
    const symbols = ['b', 'λ'];
    setAlphabet(draft, symbols);
    symbols.push('c');
    expect(draft.alphabet).toEqual(['b', 'λ']);
    expect(draft.transitions.map(edge => edge.input)).toEqual(['b', 'b']);
    const before = cloneDraft(draft);
    expect(() => setAlphabet(draft, ['b', 'b'])).toThrow(/already|duplicate/i);
    expect(() => setAlphabet(draft, ['a b'])).toThrow(/token/i);
    expect(() => fillMissing(draft, 'bad#output')).toThrow(/token/i);
    expect(draft).toEqual(before);
  });

  it('copies all nested draft editing data for undo without shared mutations', () => {
    const draft = twoStates();
    setAlphabet(draft, ['a']);
    fillMissing(draft);
    const snapshot = cloneDraft(draft);
    draft.states[0]!.name = 'Changed'; draft.states[0]!.x = 99;
    draft.transitions[0]!.output = '1'; draft.alphabet.push('b');
    expect(snapshot.states[0]).toMatchObject({ name: 'A', x: 0 });
    expect(snapshot.transitions[0]!.output).toBe('0');
    expect(snapshot.alphabet).toEqual(['a']);
  });
});

describe('graph draft interoperability', () => {
  it('round trips paired-bit inputs and word outputs through graph and text files', () => {
    const draft = twoStates();
    const [a, b] = draft.states;
    setAlphabet(draft, ['00', '01', '10', '11']);
    upsertTransition(draft, { from: a!.id, to: b!.id, input: '11', output: 'carry' });
    upsertTransition(draft, { from: b!.id, to: a!.id, input: '00', output: 'clear' });
    fillMissing(draft, 'wait');
    expect(validateDraft(draft)).toEqual([]);
    const restored = parseDraft(serializeDraft(draft));
    expect(restored).toEqual(draft);
    const definition = draftToMachine(restored);
    expect(simulate(definition, '11 01 00 10').output).toBe('carry wait clear wait');
    const imported = parseDraft(draftToSource(restored));
    expect(simulate(draftToMachine(imported), '11 01 00 10')).toEqual(simulate(definition, '11 01 00 10'));
  });

  it('accepts event names and Unicode token outputs for Moore states', () => {
    const draft = twoStates('moore');
    const [a, b] = draft.states;
    a!.output = 'locked'; b!.output = '🔓open';
    setAlphabet(draft, ['coin', 'push']);
    upsertTransition(draft, { from: a!.id, to: b!.id, input: 'coin', output: '' });
    upsertTransition(draft, { from: b!.id, to: a!.id, input: 'push', output: '' });
    fillMissing(draft);
    expect(validateDraft(draft)).toEqual([]);
    const restored = parseDraft(serializeDraft(draft));
    expect(simulate(draftToMachine(restored), 'coin push').output).toBe('locked 🔓open locked');
    expect(parse(draftToSource(restored)).errors).toEqual([]);
  });

  it('preserves matching saved positions and initializes other states with the BFS layout', () => {
    const machine = parse('type mealy\nstart A\nA a B 1\nB a A 0').machine!;
    const positions = record<{ x: number; y: number }>();
    positions.A = { x: 0, y: 35 };
    const draft = draftFromMachine(machine, positions);
    expect(draft.states.map(state => state.name)).toEqual(['A', 'B']);
    expect(draft.states[0]).toMatchObject({ x: 0, y: 35 });
    expect(draft.states[1]!.x).toBeGreaterThan(0);
    expect(draft.states[1]!.y).toBeGreaterThan(0);
    expect(draftToMachine(draft)).toEqual(machine);
    expect(draftFromMachine(machine, Object.create({ A: { x: 9, y: 9 } })).states[0]!.x).not.toBe(9);
  });

  it('declares isolated draft states in source and keeps valid text imports runnable', () => {
    const draft = twoStates();
    setAlphabet(draft, ['a', 'b', 'c', 'λ']);
    const source = draftToSource(draft);
    expect(source).toContain('state A\nstate B\n');
    expect(source).toContain('alphabet a b c λ\n');
    expect(parse(source).errors).toHaveLength(8);
    expect(() => parseDraft(source)).toThrow(/transition/i);
    fillMissing(draft, '✨');
    const restored = parseDraft(draftToSource(draft));
    expect(simulate(draftToMachine(restored), 'abcλ').output).toBe('✨✨✨✨');
  });

  it('round trips an incomplete, positioned draft through the versioned graph file', () => {
    const draft = twoStates('moore');
    draft.start = ''; draft.states[1]!.output = '';
    setAlphabet(draft, ['🙂', 'λ']);
    upsertTransition(draft, { from: draft.states[0]!.id, to: draft.states[1]!.id, input: '🙂', output: '' });
    const source = serializeDraft(draft);
    expect(JSON.parse(source)).toMatchObject({ format: 'patchbay-graph', version: 1 });
    expect(parseDraft(source)).toEqual(draft);
    expect(validateDraft(parseDraft(source)).length).toBeGreaterThan(0);
  });

  it('keeps prototype-like names safe in graph, text, and runnable engine records', () => {
    const draft = createDraft();
    const a = addState(draft, 0, 0, '__proto__');
    const b = addState(draft, 100, 100, 'constructor');
    const c = addState(draft, 200, 100, 'toString');
    upsertTransition(draft, { from: a.id, to: b.id, input: 'λ', output: '1' });
    upsertTransition(draft, { from: b.id, to: c.id, input: 'λ', output: '0' });
    upsertTransition(draft, { from: c.id, to: a.id, input: 'λ', output: '1' });
    const machine = draftToMachine(parseDraft(serializeDraft(draft)));
    expect(Object.getPrototypeOf(machine.delta)).toBeNull();
    expect(Object.getPrototypeOf(machine.delta.__proto__)).toBeNull();
    expect(Object.getPrototypeOf(machine.outputs.lambda)).toBeNull();
    expect(simulate(machine, 'λλλ').output).toBe('101');
    expect(parse(draftToSource(draft)).machine).toEqual(machine);
  });

  it('supports more than 256 states and 1,000 transitions with a Unicode nonbinary alphabet', () => {
    const draft = createDraft();
    const states = Array.from({ length: 300 }, (_, i) => addState(draft, i * 60, 120));
    const symbols = ['a', 'b', 'c', 'λ', '🙂'];
    const outputs = ['α', 'β', 'γ', 'δ', 'ε'];
    for (let index = 0; index < states.length; index++) {
      for (let inputIndex = 0; inputIndex < symbols.length; inputIndex++) {
        upsertTransition(draft, {
          from: states[index]!.id, to: states[(index + 1) % states.length]!.id,
          input: symbols[inputIndex]!, output: outputs[inputIndex]!,
        });
      }
    }
    expect(validateDraft(draft)).toEqual([]);
    expect(draft.states).toHaveLength(300);
    expect(draft.transitions).toHaveLength(1500);
    const restored = parseDraft(serializeDraft(draft));
    expect(restored.states).toHaveLength(300);
    expect(restored.transitions).toHaveLength(1500);
    const machine = parse(draftToSource(restored)).machine!;
    expect(machine.alphabet).toEqual(symbols);
    expect(simulate(machine, 'abcλ🙂'.repeat(10))).toMatchObject({ output: 'αβγδε'.repeat(10) });
    expect(simulate(machine, 'abcλ🙂'.repeat(10)).fault).toBeUndefined();
  });
});

describe('graph file structural validation', () => {
  it.each([
    ['unknown start', (draft: GraphDraft) => { draft.start = 'missing'; }],
    ['duplicate state ids', (draft: GraphDraft) => { draft.states[1]!.id = draft.states[0]!.id; }],
    ['duplicate state names', (draft: GraphDraft) => { draft.states[1]!.name = draft.states[0]!.name; }],
    ['unknown edge source', (draft: GraphDraft) => { draft.transitions[0]!.from = 'missing'; }],
    ['unknown edge destination', (draft: GraphDraft) => { draft.transitions[0]!.to = 'missing'; }],
    ['duplicate transition ids', (draft: GraphDraft) => { draft.transitions[1]!.id = draft.transitions[0]!.id; }],
    ['state/transition id collision', (draft: GraphDraft) => { draft.transitions[0]!.id = draft.states[0]!.id; }],
    ['duplicate state/input pairs', (draft: GraphDraft) => { draft.transitions[1]!.from = draft.transitions[0]!.from; }],
    ['negative coordinates', (draft: GraphDraft) => { draft.states[0]!.x = -1; }],
    ['nonfinite coordinates', (draft: GraphDraft) => { draft.states[0]!.y = Infinity; }],
    ['invalid nextId', (draft: GraphDraft) => { draft.nextId = -1; }],
    ['fractional nextId', (draft: GraphDraft) => { draft.nextId = 1.5; }],
    ['unknown kind', (draft: GraphDraft) => { draft.kind = 'other' as GraphDraft['kind']; }],
    ['reserved name', (draft: GraphDraft) => { draft.states[0]!.name = 'alphabet'; }],
    ['unsafe name', (draft: GraphDraft) => { draft.states[0]!.name = 'A#B'; }],
    ['whitespace input', (draft: GraphDraft) => { draft.transitions[0]!.input = 'a b'; }],
    ['unknown input', (draft: GraphDraft) => { draft.transitions[0]!.input = 'b'; }],
    ['invalid output', (draft: GraphDraft) => { draft.transitions[0]!.output = 'a#b'; }],
    ['duplicate alphabet symbols', (draft: GraphDraft) => { draft.alphabet.push('a'); }],
    ['unexpected fields', (draft: GraphDraft) => { (draft.states[0] as unknown as Record<string, unknown>).extra = true; }],
  ])('rejects corrupt graph files: %s', (_name, mutate) => {
    const draft = twoStates();
    setAlphabet(draft, ['a']);
    fillMissing(draft);
    const wrapper = JSON.parse(serializeDraft(draft)) as { draft: GraphDraft };
    mutate(wrapper.draft);
    expect(() => parseDraft(JSON.stringify(wrapper))).toThrow();
  });

  it.each(['[]', '{}', '{broken', '{"format":"other","version":1,"draft":{}}', '{"format":"patchbay-graph","version":2,"draft":{}}'])('rejects invalid wrappers %s', (source) => {
    expect(() => parseDraft(source)).toThrow();
  });

  it('rejects malicious extra prototype properties without assigning them to live objects', () => {
    const draft = createDraft();
    const source = serializeDraft(draft).replace('"draft": {', '"draft": { "__proto__": {"polluted": true},');
    expect(() => parseDraft(source)).toThrow(/field|property|unexpected/i);
    expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });
});
