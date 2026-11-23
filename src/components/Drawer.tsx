import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { Panel } from '../domain/contracts';
import type { NavigationSource, UIMotion } from '../motion/ui-motion';
import { useMedia } from '../app/use-visual-system';
import { useGlassSurface } from '../rendering/field';
import { Icon } from './Icon';
const copy = {
  trace: ['The trace', 'Every transition, accounted for.'],
  text: ['Text definition', 'Describe your machine. Watch it take shape.'],
  settings: ['Settings', 'Make the workspace yours.'],
} as const;
/** At this width the drawer docks beside the content as a glass sheet. */
const DOCKED = '(min-width: 1200px)';

export function Drawer({
  panel,
  onClose,
  children,
  motion,
  source,
}: {
  panel: Panel;
  onClose: (source: NavigationSource) => void;
  children: ReactNode;
  motion: RefObject<UIMotion | null>;
  /** How the latest navigation started; keyboard opens the drawer instantly. */
  source: RefObject<NavigationSource>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const docked = useMedia(DOCKED);
  // Only the docked sheet sits over the field; the overlay and the bottom
  // sheet are solid and never register with the shader.
  useGlassSurface(ref, 'sheet', !!panel && docked);
  useLayoutEffect(() => {
    const dialog = ref.current,
      animator = motion.current;
    if (!dialog) return;
    if (panel) {
      // Non-modal: the workspace beside the drawer stays operable.
      if (!dialog.open) dialog.show();
      if (source.current !== 'keyboard') animator?.enter(dialog, animator.origin(), 'drawer');
    } else if (dialog.open) dialog.close();
    return () => {
      animator?.cancel(dialog);
    };
  }, [panel, motion, source]);
  const text = panel ? copy[panel] : copy.trace;
  return (
    <dialog
      id="drawer"
      ref={ref}
      className="drawer"
      data-glass="sheet"
      data-mode={docked ? 'docked' : 'overlay'}
      aria-labelledby="drawer-title"
      aria-describedby="drawer-description"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose('keyboard');
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose('keyboard');
      }}
    >
      <header className="drawer-header">
        <div>
          <h2 id="drawer-title">{text[0]}</h2>
          <p id="drawer-description">{text[1]}</p>
        </div>
        <button
          id="close-drawer"
          className="icon-button"
          aria-label="Close drawer"
          onClick={(event) => onClose(event.detail === 0 ? 'keyboard' : 'pointer')}
        >
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
