import { describe, expect, it } from 'vitest';
import { parse } from '../src/engine/parse';
import { mealyToMoore, mooreToMealy } from '../src/engine/convert';
import { simulate, usesTokenInput } from '../src/engine/simulate';
import { serialize } from '../src/engine/serialize';
import { presets } from '../src/presets';

function presetMachine(id: string) {
  const preset = presets.find(preset => preset.id === id);
  expect(preset).toBeDefined();
  const result = parse(preset!.source);
  expect(result.errors).toEqual([]);
  return result.machine!;
}

describe('common problem presets', () => {
  it('adds every pair of four-bit operands including carry out, least significant first', () => {
    const machine = presetMachine('binary-full-adder');
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        const pairs = Array.from({ length: 4 }, (_, bit) => `${(a >> bit) & 1}${(b >> bit) & 1}`);
        const trace = simulate(machine, [...pairs, '00'].join(' '));
        const expected = (a + b).toString(2).padStart(5, '0').split('').reverse().join('');
        expect(trace.output, `${a} + ${b}`).toBe(expected);
        expect(trace.steps).toHaveLength(5);
        expect(trace.fault).toBeUndefined();
        expect(trace.steps.at(-1)!.to).toBe('C0');
      }
    }
  });

  it('detects overlapping 101 suffixes for every binary input through eight bits', () => {
    const machine = presetMachine('mealy-101-detector');
    for (let length = 0; length <= 8; length++) {
      for (let value = 0; value < 2 ** length; value++) {
        const input = length ? value.toString(2).padStart(length, '0') : '';
        const expected = Array.from(input, (_, index) => input.slice(Math.max(0, index - 2), index + 1) === '101' ? '1' : '0').join('');
        expect(simulate(machine, input).output, input).toBe(expected);
      }
    }
  });

  it('keeps the gate locked after alarms, refunds extra coins, and locks after a valid push', () => {
    const trace = simulate(presetMachine('turnstile'), 'push coin coin push push');
    expect(trace.steps.map(({ sym, out, to }) => [sym, out, to])).toEqual([
      ['push', 'alarm', 'Locked'], ['coin', 'unlock', 'Unlocked'],
      ['coin', 'refund', 'Unlocked'], ['push', 'open', 'Locked'], ['push', 'alarm', 'Locked'],
    ]);
    expect(trace.output).toBe('alarm unlock refund open alarm');
  });

  it.each([
    ['5 5 5', 'wait wait vend'], ['5 10', 'wait vend'], ['10 5', 'wait vend'],
    ['10 10', 'wait vend+5'], ['10 10 5 10', 'wait vend+5 wait vend'],
  ])('vends at price 15 and clears credit for %s', (input, expected) => {
    const trace = simulate(presetMachine('vending-machine'), input);
    expect(trace.output).toBe(expected);
    expect(trace.steps.at(-1)!.to).toBe('V0');
    expect(trace.fault).toBeUndefined();
  });

  it.each(presets.filter(({ category }) => category !== 'Binary'))('preserves $id token behavior through both conversions', ({ source }) => {
    const original = parse(source).machine!;
    const moore = mealyToMoore(original);
    const restored = parse(serialize(moore));
    expect(restored.errors).toEqual([]);
    const mealy = mooreToMealy(restored.machine!);
    let frontier: string[][] = [[]];
    for (let length = 0; length <= 3; length++) {
      for (const symbols of frontier) {
        const input = symbols.join(usesTokenInput(original) ? ' ' : '');
        const baseline = simulate(original, input);
        const converted = simulate(moore, input, { mooreInitial: false });
        expect(converted.fault).toBeUndefined();
        expect(converted.steps.map(step => step.out)).toEqual(baseline.steps.map(step => step.out));
        expect(converted.output).toBe(baseline.output);
        expect(simulate(mealy, input).output).toBe(baseline.output);
      }
      frontier = frontier.flatMap(symbols => original.alphabet.map(symbol => [...symbols, symbol]));
    }
  });
});
