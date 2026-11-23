import { useLayoutEffect, type RefObject } from 'react';
import { registerGlass, type GlassKind } from './glass-registry';

/** Registers an element as Liquid Glass: the field draws its frost, lens and
 * luminance clamp while `active`, and points its rim at the cursor light. */
export function useGlassSurface(
  ref: RefObject<HTMLElement | null>,
  kind: GlassKind,
  active = true,
): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    return registerGlass(element, kind, active);
  }, [ref, kind, active]);
}
