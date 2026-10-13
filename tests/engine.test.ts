import { describe, expect, it } from 'vitest';
import { parse } from '../src/engine/parse';
import { checkInput, joinSymbols, simulate, tokenizeInput, usesTokenInput } from '../src/engine/simulate';
import { mealyToMoore, mooreToMealy } from '../src/engine/convert';
import { serialize } from '../src/engine/serialize';
import type { MachineDef } from '../src/engine/types';
import { presets } from '../src/presets';

function machine(source: string): MachineDef {
  const result = parse(source);
  expect(result.errors).toEqual([]);
  expect(result.machine).toBeDefined();
  return result.machine!;
}

function binaryInputs(maxLength: number): string[] {
  const inputs = [''];
  for (let length = 1; length <= maxLength; length++) {
    for (let value = 0; value < 2 ** length; value++) inputs.push(value.toString(2).padStart(length, '0'));
  }
  return inputs;
}

describe('TRD preset cases', () => {
  it.each(presets)('$id produces $expected on $input', ({ source, input, expected, kind }) => {
    const definition = machine(source);
    const trace = simulate(definition, input);
    expect(trace.output).toBe(expected);
    expect(trace.steps).toHaveLength(tokenizeInput(definition, input).length);
    expect(trace.fault).toBeUndefined();
    expect(trace.steps.length + Number(trace.initialOut !== undefined)).toBe(tokenizeInput(definition, input).length + Number(kind === 'moore'));
  });

  it('preserves the precise Moore 11 detector trace', () => {
    const trace = simulate(machine(presets[1]!.source), '1101');
    expect(trace).toEqual({
      initialOut: '0', output: '00100',
      steps: [
        { i: 0, from: 'A', sym: '1', to: 'B', out: '0' },
        { i: 1, from: 'B', sym: '1', to: 'C', out: '1' },
        { i: 2, from: 'C', sym: '0', to: 'A', out: '0' },
        { i: 3, from: 'A', sym: '1', to: 'B', out: '0' },
      ],
    });
  });
});

describe('parser validation', () => {
  it('ignores comments and blank lines without losing line numbers', () => {
    expect(parse('# Header\n\ntype mealy # comment\nstart A\nA 0 A 1 # invert\n').errors).toEqual([]);
    const result = parse('# Header\n\ntype mealy\nstart Z\nA 0 A 1\n');
    expect(result.machine).toBeUndefined();
    expect(result.errors).toEqual([{ line: 4, msg: expect.stringContaining('Start state Z') }]);
  });

  it('rejects incomplete machines and reports the state declaration line', () => {
    const result = parse('type mealy\nstart A\nA 0 B 0\nA 1 A 1\nB 0 A 0');
    expect(result.machine).toBeUndefined();
    expect(result.errors).toContainEqual({ line: 3, msg: expect.stringContaining('State B has no transition for "1"') });
  });

  it('requires an output for every Moore state, including destinations', () => {
    const result = parse('type moore\nstart A\nout A 0\nA 0 B\nB 0 A');
    expect(result.errors).toContainEqual({ line: 4, msg: expect.stringContaining('State B has no output') });
  });

  it('rejects duplicate transitions and outputs at the duplicate line', () => {
    const transitions = parse('type mealy\nstart A\nA 0 A 0\nA 0 A 1');
    expect(transitions.errors).toContainEqual({ line: 4, msg: expect.stringContaining('already has a transition') });
    const outputs = parse('type moore\nstart A\nout A 0\nout A 1\nA 0 A');
    expect(outputs.errors).toContainEqual({ line: 4, msg: expect.stringContaining('already has an output') });
  });

  it.each([
    '', 'type other\nstart A\nA 0 A 0', 'type mealy\nA 0 A 0',
    'type mealy\nstart A\nA 0 A', 'type mealy\nstart A\nout A 0\nA 0 A 0',
    'type mealy\ntype moore\nstart A\nA 0 A 0',
    'type mealy\nstart A\nstart A\nA 0 A 0',
  ])('rejects malformed definitions: %s', (source) => {
    expect(parse(source).machine).toBeUndefined();
    expect(parse(source).errors.length).toBeGreaterThan(0);
    expect(parse(source).errors.every(({ line }) => line >= 1)).toBe(true);
  });

  it('handles Unicode symbols as single symbols', () => {
    const definition = machine('type mealy\nstart A\nA 🙂 A ✨');
    expect(simulate(definition, '🙂🙂').output).toBe('✨✨');
    expect(checkInput(definition, '🙂?')).toEqual([{ index: 1, sym: '?' }]);
  });

  it('accepts prototype-like state names without pollution or inherited transitions', () => {
    const definition = machine('type mealy\nstart __proto__\n__proto__ 0 constructor 1\nconstructor 0 toString 0\ntoString 0 __proto__ 1');
    expect(simulate(definition, '000').output).toBe('101');
    expect(Object.getPrototypeOf(definition.delta)).toBeNull();
    expect(Object.getPrototypeOf(definition.outputs.lambda)).toBeNull();
  });
});

describe('simulation boundaries', () => {
  it('handles empty input and the switchable Moore initial output', () => {
    expect(simulate(machine(presets[0]!.source), '')).toEqual({ steps: [], output: '' });
    expect(simulate(machine(presets[1]!.source), '')).toEqual({ steps: [], output: '0', initialOut: '0' });
    expect(simulate(machine(presets[1]!.source), '', { mooreInitial: false })).toEqual({ steps: [], output: '' });
    expect(simulate(machine(presets[1]!.source), '1101', { mooreInitial: false }).output).toBe('0100');
  });

  it('reports every invalid input symbol and safely stops on the first', () => {
    const definition = machine(presets[0]!.source);
    expect(checkInput(definition, '1x0?')).toEqual([{ index: 1, sym: 'x' }, { index: 3, sym: '?' }]);
    expect(simulate(definition, '1x0?')).toMatchObject({ output: '0', fault: { at: 1, state: 'B', sym: 'x' } });
  });

  it('preserves the completed prefix when a partial machine faults', () => {
    const definition = machine(presets[0]!.source);
    delete definition.delta.B!['1'];
    expect(() => simulate(definition, '110')).not.toThrow();
    const trace = simulate(definition, '110');
    expect(trace.output).toBe('0');
    expect(trace.steps).toHaveLength(1);
    expect(trace.fault).toEqual({ at: 1, state: 'B', sym: '1' });
  });

  it('faults for missing outputs and unknown destination states', () => {
    const definition = machine(presets[0]!.source);
    if (definition.outputs.kind === 'mealy') delete definition.outputs.lambda.A!['0'];
    expect(simulate(definition, '0').fault).toEqual({ at: 0, state: 'A', sym: '0' });
    definition.delta.A!['1'] = 'missing';
    expect(simulate(definition, '1').fault).toEqual({ at: 0, state: 'A', sym: '1' });
  });

  it('runs 64 symbols deterministically without mutating the machine', () => {
    const definition = machine(presets[0]!.source);
    const before = JSON.stringify(definition);
    const input = '1'.repeat(64);
    const first = simulate(definition, input);
    expect(first.output).toBe('0' + '1'.repeat(63));
    expect(first.steps).toHaveLength(64);
    expect(simulate(definition, input)).toEqual(first);
    expect(JSON.stringify(definition)).toBe(before);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });

  it('runs a 10-state machine', () => {
    const source = ['type moore', 'start S0'];
    for (let i = 0; i < 10; i++) source.push(`out S${i} ${i}`);
    for (let i = 0; i < 10; i++) source.push(`S${i} 0 S${(i + 1) % 10}`);
    const definition = machine(source.join('\n'));
    expect(definition.states).toHaveLength(10);
    expect(simulate(definition, '0'.repeat(10)).output).toBe('01234567890');
  });
});

describe('token alphabets and outputs', () => {
  const source = 'type mealy\nstart A\nalphabet 00 01 10 11\nA 00 A no\nA 01 A yes\nA 10 A 0\nA 11 A 10';

  it('treats paired bits as whole inputs and words as whole outputs', () => {
    const definition = machine(source);
    const input = ' 00\t01\n10 11 ';
    expect(usesTokenInput(definition)).toBe(true);
    expect(tokenizeInput(definition, input)).toEqual(['00', '01', '10', '11']);
    expect(checkInput(definition, input)).toEqual([]);
    const trace = simulate(definition, input);
    expect(trace.output).toBe('no yes 0 10');
    expect(trace.steps.map(({ i, sym, out }) => ({ i, sym, out }))).toEqual([
      { i: 0, sym: '00', out: 'no' }, { i: 1, sym: '01', out: 'yes' },
      { i: 2, sym: '10', out: '0' }, { i: 3, sym: '11', out: '10' },
    ]);
    expect(joinSymbols(definition, ['0', '10'])).toBe('0 10');
  });

  it('reports token positions and preserves completed output at an invalid token', () => {
    const definition = machine(source);
    expect(checkInput(definition, '00 wrong 11 nope')).toEqual([{ index: 1, sym: 'wrong' }, { index: 3, sym: 'nope' }]);
    expect(simulate(definition, '00 wrong 11')).toMatchObject({ output: 'no', fault: { at: 1, state: 'A', sym: 'wrong' } });
    expect(checkInput(definition, '0001')).toEqual([{ index: 0, sym: '0001' }]);
    expect(simulate(definition, ' \t\n')).toEqual({ output: '', steps: [] });
  });

  it('keeps single-codepoint input/output tapes concatenated, including emoji', () => {
    const definition = machine('type mealy\nstart A\nA 🙂 A ✨\nA λ A β');
    expect(usesTokenInput(definition)).toBe(false);
    expect(tokenizeInput(definition, '🙂λ🙂')).toEqual(['🙂', 'λ', '🙂']);
    expect(simulate(definition, '🙂λ🙂').output).toBe('✨β✨');
    expect(checkInput(definition, '🙂 λ')).toEqual([{ index: 1, sym: ' ' }]);
    expect(joinSymbols(definition, ['✨', 'β'])).toBe('✨β');
  });

  it('supports mixed input token lengths and multi-codepoint Unicode graphemes', () => {
    const definition = machine('type moore\nstart A\nout A ready\nA 0 A\nA coin A\nA é A');
    expect(tokenizeInput(definition, '0 coin é')).toEqual(['0', 'coin', 'é']);
    expect(simulate(definition, '0 coin é').output).toBe('ready ready ready ready');
    expect(simulate(definition, '0 coin é', { mooreInitial: false }).output).toBe('ready ready ready');
  });

  it('preserves token sequences through both converters and text serialization', () => {
    const definition = machine(source);
    const converted = mealyToMoore(definition, 'ready');
    expect(simulate(converted, '00 01 10 11').output).toBe('ready no yes 0 10');
    expect(simulate(converted, '00 01 10 11', { mooreInitial: false }).output).toBe(simulate(definition, '00 01 10 11').output);
    const restored = machine(serialize(converted));
    const roundTrip = mooreToMealy(restored);
    expect(simulate(roundTrip, '00 01 10 11').output).toBe('no yes 0 10');
    expect(() => mealyToMoore(definition, 'bad output')).toThrow(/token|symbol/i);
    expect(() => mealyToMoore(definition, '\ud800')).toThrow(/token|symbol/i);
  });

  it('keeps binary step output compact when a converted initial word is omitted', () => {
    const definition = machine('type mealy\nstart A\nA 0 A 1\nA 1 A 0');
    const converted = mealyToMoore(definition, 'ready');
    expect(simulate(converted, '01').output).toBe('ready 1 0');
    expect(simulate(converted, '01', { mooreInitial: false }).output).toBe('10');
    expect(simulate(machine(serialize(converted)), '01', { mooreInitial: false }).output).toBe('10');
  });
});

describe('conversion and serialization', () => {
  it.each(presets.filter(({ kind, category }) => kind === 'moore' && category === 'Binary'))('converts $id for every binary input through length 6', ({ source }) => {
    const original = machine(source);
    const before = JSON.stringify(original);
    const converted = mooreToMealy(original);
    for (const input of binaryInputs(6)) {
      expect(simulate(converted, input).output).toBe(simulate(original, input, { mooreInitial: false }).output);
    }
    expect(JSON.stringify(original)).toBe(before);
  });

  it.each(presets.filter(({ kind, category }) => kind === 'mealy' && category === 'Binary'))('splits states for $id and uses an explicit initial-output convention', ({ source }) => {
    const original = machine(source);
    const converted = mealyToMoore(original, 'x');
    expect(simulate(converted, '').output).toBe('x');
    for (const input of binaryInputs(6)) {
      expect(simulate(converted, input, { mooreInitial: false }).output).toBe(simulate(original, input).output);
    }
    expect(parse(serialize(converted)).errors).toEqual([]);
  });

  it.each(presets)('round trips $id through the editor text format', ({ source, input }) => {
    const original = machine(source);
    const restored = machine(serialize(original));
    expect(simulate(restored, input)).toEqual(simulate(original, input));
    expect(restored.states).toEqual(original.states);
    expect(restored.alphabet).toEqual(original.alphabet);
  });
});
