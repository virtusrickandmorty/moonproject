/** Small hook harness for inspecting form handlers without a browser or a new test dependency. */
import { vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { DocTypeInfo } from '../../api.ts';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[i], (next: unknown) => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }];
  },
  useEffect: () => undefined,
  useMemo: (run: () => unknown) => run(),
  useRef: (current: unknown) => ({ current }),
}));
vi.mock('../../generic/record.tsx', () => ({ useRecord: () => recorder }));
vi.mock('../COL/parts.tsx', async (original) => ({ ...await original<typeof import('../COL/parts.tsx')>(), useLive: () => null }));
vi.mock('../../router.tsx', () => ({ navigate: vi.fn() }));

export const recorder = { gate: null, top: null, dialog: null, original: null, touched: false, title: (s: string) => s, ask: vi.fn(), preview: vi.fn(), fail: vi.fn() };
export const type = (key: string) => ({ key, canPost: true, canCreate: true }) as DocTypeInfo;
type Node = ReactElement<Record<string, any>>;
export function nodes(root: ReactNode): Node[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement(root)) return [];
  const node = root as Node;
  return [node, ...nodes(node.props.children)];
}
export function form(run: () => ReactNode, initial: unknown[] = []) {
  hooks.values = initial;
  const render = () => { hooks.cursor = 0; return nodes(run()); };
  return {
    render,
    find: (prop: string, value: unknown) => {
      const node = render().find((n) => n.props[prop] === value);
      if (!node) throw new Error(`Missing ${prop}: ${String(value)}`);
      return node;
    },
    field: (label: string) => {
      const field = render().find((n) => n.props.label === label);
      if (!field) throw new Error(`Missing field: ${label}`);
      return nodes(field.props.children)[0]!;
    },
  };
}
export const change = (node: Node, value: string) => node.props.onChange({ target: { value } });
