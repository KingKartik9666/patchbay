export type PresetCategory = 'Binary' | 'Multi-variable' | 'Events' | 'Decimal';

export interface Preset {
  id: string;
  name: string;
  kind: 'mealy' | 'moore';
  category: PresetCategory;
  description: string;
  input: string;
  source: string;
  expected: string;
}

export const presets: Preset[] = [
  {
    id: 'mealy-11-detector', name: '11 detector', kind: 'mealy', category: 'Binary',
    description: 'Prints 1 when two consecutive 1s are read. Overlapping pairs count.',
    input: '1101', expected: '0100',
    source: `# Output lives on each transition.\ntype mealy\nstart A\n\nA 0 A 0\nA 1 B 0\nB 0 A 0\nB 1 B 1\n`,
  },
  {
    id: 'moore-11-detector', name: '11 detector', kind: 'moore', category: 'Binary',
    description: 'State C prints 1 after two consecutive 1s. Includes the initial output.',
    input: '1101', expected: '00100',
    source: `# Output lives on each state.\ntype moore\nstart A\nout A 0\nout B 0\nout C 1\n\nA 0 A\nA 1 B\nB 0 A\nB 1 C\nC 0 A\nC 1 C\n`,
  },
  {
    id: 'ones-complement', name: "One’s complement", kind: 'mealy', category: 'Binary',
    description: 'Flips every input bit: 0 becomes 1, and 1 becomes 0.',
    input: '10110', expected: '01001',
    source: `# Flip every bit.\ntype mealy\nstart A\n\nA 0 A 1\nA 1 A 0\n`,
  },
  {
    id: 'twos-complement', name: "Two’s complement", kind: 'mealy', category: 'Binary',
    description: 'Reads least significant bit first. Copies through the first 1, then flips the rest.',
    input: '0011', expected: '0010',
    source: `# Read least significant bit first.\n# A copies until the first 1; B complements remaining bits.\ntype mealy\nstart A\n\nA 0 A 0\nA 1 B 1\nB 0 B 1\nB 1 B 0\n`,
  },
  {
    id: 'parity', name: 'Parity checker', kind: 'moore', category: 'Binary',
    description: 'Prints 0 for an even number of 1s so far, and 1 for an odd number.',
    input: '1101', expected: '01001',
    source: `# E = even parity, O = odd parity.\ntype moore\nstart E\nout E 0\nout O 1\n\nE 0 E\nE 1 O\nO 0 O\nO 1 E\n`,
  },
  {
    id: 'mod3-remainder', name: 'Modulo 3', kind: 'moore', category: 'Binary',
    description: 'Reads a binary number most significant bit first and prints its running remainder modulo 3.',
    input: '110', expected: '0100',
    source: `# Read most significant bit first.\n# Next remainder = (2 * current remainder + bit) mod 3.\ntype moore\nstart R0\nout R0 0\nout R1 1\nout R2 2\n\nR0 0 R0\nR0 1 R1\nR1 0 R2\nR1 1 R0\nR2 0 R1\nR2 1 R2\n`,
  },
  {
    id: 'decimal-echo', name: 'Decimal echo', kind: 'mealy', category: 'Decimal',
    description: 'Reads and writes any digit from 0 to 9. Ten input symbols, one state.',
    input: '290846', expected: '290846',
    source: `type mealy\nstart Digit\nalphabet 0 1 2 3 4 5 6 7 8 9\nstate Digit\n${Array.from({length:10},(_,digit)=>`Digit ${digit} Digit ${digit}`).join('\n')}\n`,
  },
  {
    id: 'mealy-101-detector', name: '101 sequence detector', kind: 'mealy', category: 'Binary',
    description: 'Prints 1 when the latest three bits are 101. Overlapping matches count.',
    input: '10101', expected: '00101',
    source: `# A = no prefix, B = 1, C = 10.\ntype mealy\nstart A\nalphabet 0 1\nA 0 A 0\nA 1 B 0\nB 0 C 0\nB 1 B 0\nC 0 A 0\nC 1 B 1\n`,
  },
  {
    id: 'binary-full-adder', name: 'Two-variable full adder', kind: 'mealy', category: 'Multi-variable',
    description: 'Each 00, 01, 10 or 11 token supplies a pair of bits, least significant first. Append 00 to write the final carry.',
    input: '11 01 10 00', expected: '0001',
    source: `# Each input token is A_bit B_bit at one bit position.\n# Read least significant first; C0 and C1 remember the carry.\n# Append a 00 input after the last data pair to emit the carry.\ntype mealy\nstart C0\nalphabet 00 01 10 11\nC0 00 C0 0\nC0 01 C0 1\nC0 10 C0 1\nC0 11 C1 0\nC1 00 C0 1\nC1 01 C1 0\nC1 10 C1 0\nC1 11 C1 1\n`,
  },
  {
    id: 'turnstile', name: 'Turnstile controller', kind: 'mealy', category: 'Events',
    description: 'A coin unlocks the gate; push opens and locks it again. A locked push alarms, and an extra coin is refunded.',
    input: 'push coin push coin coin push', expected: 'alarm unlock open unlock refund open',
    source: `type mealy\nstart Locked\nalphabet coin push\nLocked coin Unlocked unlock\nLocked push Locked alarm\nUnlocked coin Unlocked refund\nUnlocked push Locked open\n`,
  },
  {
    id: 'vending-machine', name: 'Vending machine', kind: 'mealy', category: 'Decimal',
    description: 'Accepts 5 or 10 coin tokens for an item costing 15. Vend resets credit; vend+5 also returns 5 in change.',
    input: '5 10 10 10', expected: 'wait vend wait vend+5',
    source: `# Credit states V0, V5 and V10; item price is 15.\n# Each vend returns to zero credit.\ntype mealy\nstart V0\nalphabet 5 10\nV0 5 V5 wait\nV0 10 V10 wait\nV5 5 V10 wait\nV5 10 V0 vend\nV10 5 V0 vend\nV10 10 V0 vend+5\n`,
  },
];
