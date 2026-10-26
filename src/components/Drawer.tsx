import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { Panel } from '../domain/contracts';
import type { UIMotion } from '../motion/ui-motion';
import { Icon } from './Icon';
const copy = {
  trace: ['The trace', 'Every transition, accounted for.'],
  text: ['Text definition', 'Describe your machine. Watch it take shape.'],
  settings: ['Settings', 'Make the workspace yours.'],
} as const;
export function Drawer({
  panel,
  onClose,
  children,
  motion,
}: {
  panel: Panel;
  onClose: () => void;
  children: ReactNode;
  motion: RefObject<UIMotion | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current,
      animator = motion.current;
    if (!dialog) return;
    if (panel) {
      if (!dialog.open) dialog.show();
      animator?.enter(dialog, animator.origin(), 'drawer');
    } else if (dialog.open) dialog.close();
    return () => {
      animator?.cancel(dialog);
    };
  }, [panel, motion]);
  const text = panel ? copy[panel] : copy.trace;
  return (
    <dialog
      id="drawer"
      ref={ref}
      className="drawer"
      aria-labelledby="drawer-title"
      aria-describedby="drawer-description"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
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
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
