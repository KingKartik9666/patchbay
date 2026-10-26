import { describe, expect, it } from 'vitest';
import { buildDiagram, EDGE_SAMPLES, pointAt, sampleCubic } from '../src/diagram/layout';
import type { MachineDef } from '../src/domain/contracts';
import presets from './fixtures/presets.json';
import fixtures from './fixtures/layout-machines.json';

const box = { w: 1100, h: 440 };
const machineFrom = (source: string) => {
  const result = fixtures.cases.find((item) => item.source === source);
  if (!result) throw new Error('Missing frozen layout fixture');
  return result.machine as unknown as MachineDef;
};

describe('diagram layout', () => {
  it.each(presets)(
    '$id: visits the start first and produces finite sampled rim edges',
    (preset) => {
      const machine = machineFrom(preset.source);
      const result = buildDiagram(machine, box);
      expect(result.nodes[0].id).toBe(machine.start);
      expect(result.nodes[0].depth).toBe(0);
      expect(result.nodes).toHaveLength(machine.states.length);
      expect(result.nodes.map((node) => node.order)).toEqual(result.nodes.map((_, i) => i));
      for (const edge of result.edges) {
        expect(edge.pts).toHaveLength(EDGE_SAMPLES * 2);
        expect(edge.len).toHaveLength(EDGE_SAMPLES);
        expect(edge.length).toBeGreaterThan(0);
        expect([...edge.pts, ...edge.len].every(Number.isFinite)).toBe(true);
        for (let i = 1; i < EDGE_SAMPLES; i++)
          expect(edge.len[i]).toBeGreaterThanOrEqual(edge.len[i - 1]);
        const source = result.nodes.find((node) => node.id === edge.from)!;
        const destination = result.nodes.find((node) => node.id === edge.to)!;
        const first = pointAt(edge, 0),
          last = pointAt(edge, 1);
        expect(Math.hypot(first.x - source.x, first.y - source.y)).toBeCloseTo(source.r, 1);
        expect(Math.hypot(last.x - destination.x, last.y - destination.y)).toBeCloseTo(
          destination.r,
          1,
        );
      }
    },
  );

  it('discovers breadth-first in alphabet order independently of definition order', () => {
    const machine: MachineDef = {
      states: ['C', 'D', 'B', 'A'],
      alphabet: ['0', '1'],
      start: 'A',
      delta: {
        A: { 0: 'B', 1: 'C' },
        B: { 0: 'D', 1: 'B' },
        C: { 0: 'C', 1: 'C' },
        D: { 0: 'D', 1: 'D' },
      },
      outputs: { kind: 'moore', lambda: { A: '0', B: '1', C: '0', D: '1' } },
    };
    const diagram = buildDiagram(machine, box);
    expect(diagram.nodes.map((node) => node.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(diagram.nodes.map((node) => node.depth)).toEqual([0, 1, 1, 2]);
    expect(diagram.nodes.every((node) => node.reachable)).toBe(true);
    expect(diagram.nodes.find((node) => node.id === 'B')!.out).toBe('1');
  });

  it('places unreachable states after reachable states in definition order', () => {
    const machine = machineFrom(
      'type moore\nstart A\nout X 0\nout A 0\nout Y 1\nX 0 X\nA 0 A\nY 0 Y',
    );
    const diagram = buildDiagram(machine, box);
    expect(diagram.nodes.map((node) => [node.id, node.depth, node.reachable])).toEqual([
      ['A', 0, true],
      ['X', 1, false],
      ['Y', 1, false],
    ]);
    expect(diagram.edges.filter((edge) => !edge.reachable)).toHaveLength(2);
  });

  it('merges parallel transitions and preserves input/output notation', () => {
    const machine = machineFrom(presets.find((preset) => preset.id === 'ones-complement')!.source);
    const { nodes, edges } = buildDiagram(machine, box);
    expect(nodes[0].out).toBeUndefined();
    expect(edges).toHaveLength(1);
    expect(edges[0].labels).toEqual(['0/1', '1/0']);
    expect(edges[0].symbols).toEqual(['0', '1']);
    expect(edges[0].kind).toBe('loop');
  });

  it('separates reciprocal curves and classifies loops, forward and back edges', () => {
    const machine = machineFrom(presets[0].source);
    const { nodes, edges } = buildDiagram(machine, box);
    const forward = edges.find((edge) => edge.from === 'A' && edge.to === 'B')!;
    const back = edges.find((edge) => edge.from === 'B' && edge.to === 'A')!;
    expect(forward.kind).toBe('forward');
    expect(back.kind).toBe('back');
    expect(edges.filter((edge) => edge.kind === 'loop')).toHaveLength(2);
    expect(pointAt(forward, 0.5).y).toBeLessThan(nodes[0].y);
    expect(pointAt(back, 0.5).y).toBeGreaterThan(nodes[0].y);
  });

  it('provides equal arc-length advances on strongly curved paths', () => {
    const samples = sampleCubic(
      { x: 0, y: 0 },
      { x: 0, y: 400 },
      { x: 400, y: 400 },
      { x: 400, y: 0 },
    );
    const distances: number[] = [];
    for (let i = 0; i < 20; i++) {
      const a = pointAt(samples, i / 20),
        b = pointAt(samples, (i + 1) / 20);
      distances.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    expect(Math.max(...distances) / Math.min(...distances)).toBeLessThan(1.012);
    const reusable = { x: -1, y: -1 };
    expect(pointAt(samples, 0.5, reusable)).toBe(reusable);
    expect(pointAt(samples, -3)).toEqual(pointAt(samples, 0));
    expect(pointAt(samples, 3)).toEqual(pointAt(samples, 1));
  });

  it('is deterministic and finite for zero-size hosts, degenerate curves and ten states', () => {
    const machine = machineFrom(presets[0].source);
    expect(buildDiagram(machine, box)).toEqual(buildDiagram(machine, box));
    for (const size of [
      { w: 0, h: 0 },
      { w: NaN, h: Infinity },
      { w: 1, h: 1 },
    ]) {
      const result = buildDiagram(machine, size);
      expect(result.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(
        true,
      );
      expect(result.edges.every((edge) => [...edge.pts, ...edge.len].every(Number.isFinite))).toBe(
        true,
      );
    }
    const point = { x: 4, y: 4 };
    expect(pointAt(sampleCubic(point, point, point, point), 0.5)).toEqual(point);
    const source = [
      'type moore',
      'start S0',
      ...Array.from({ length: 10 }, (_, i) => `out S${i} ${i % 2}\nS${i} 0 S${(i + 1) % 10}`),
    ].join('\n');
    const ten = buildDiagram(machineFrom(source), box);
    expect(ten.nodes.map((node) => node.depth)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ten.edges.every((edge) => [...edge.pts].every(Number.isFinite))).toBe(true);
  });

  it('keeps branching states separated in a scrollable drawing area', () => {
    const machine = machineFrom(
      'type mealy\nstart A\nA 0 B 0\nA 1 C 1\nB 0 D 0\nB 1 E 1\nC 0 F 0\nC 1 G 1\nD 0 D 0\nD 1 D 1\nE 0 E 0\nE 1 E 1\nF 0 F 0\nF 1 F 1\nG 0 G 0\nG 1 G 1',
    );
    for (const viewport of [
      { w: 1248, h: 280 },
      { w: 314, h: 310 },
    ]) {
      const result = buildDiagram(machine, viewport);
      expect(result.nodes).toHaveLength(7);
      expect(result.height).toBeGreaterThan(viewport.h);
      for (let i = 0; i < result.nodes.length; i++) {
        const a = result.nodes[i];
        expect(a.x - a.r).toBeGreaterThanOrEqual(0);
        expect(a.y - a.r).toBeGreaterThanOrEqual(0);
        expect(a.x + a.r).toBeLessThanOrEqual(result.width);
        expect(a.y + a.r).toBeLessThanOrEqual(result.height);
        for (const b of result.nodes.slice(i + 1)) {
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r + 20);
        }
      }
    }
  });

  it('preserves readable column spacing for a ten-state chain on a narrow viewport', () => {
    const source = [
      'type moore',
      'start S0',
      ...Array.from({ length: 10 }, (_, i) => `out S${i} ${i % 2}\nS${i} 0 S${(i + 1) % 10}`),
    ].join('\n');
    const result = buildDiagram(machineFrom(source), { w: 314, h: 310 });
    expect(result.width).toBeGreaterThan(314);
    for (let i = 1; i < result.nodes.length; i++) {
      expect(result.nodes[i].x - result.nodes[i - 1].x).toBeGreaterThan(result.nodes[i].r * 2 + 20);
    }
  });
});
