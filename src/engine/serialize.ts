import { own, type MachineDef } from './types';

/** Machine text suitable for the editor and a lossless parser round trip. */
export function serialize(machine: MachineDef): string {
  const lines = [
    `type ${machine.outputs.kind}`, `start ${machine.start}`,
    `alphabet ${machine.alphabet.join(' ')}`.trimEnd(),
    ...machine.states.map(state => `state ${state}`),
  ];
  if (machine.outputs.kind === 'moore') {
    for (const state of machine.states) {
      const output = own(machine.outputs.lambda, state);
      if (output !== undefined) lines.push(`out ${state} ${output}`);
    }
  }
  lines.push('');
  for (const from of machine.states) {
    for (const sym of machine.alphabet) {
      const to = own(own(machine.delta, from), sym);
      if (to === undefined) continue;
      if (machine.outputs.kind === 'mealy') {
        const output = own(own(machine.outputs.lambda, from), sym);
        lines.push(`${from} ${sym} ${to}${output === undefined ? '' : ` ${output}`}`);
      } else lines.push(`${from} ${sym} ${to}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export const serializeMachine = serialize;
