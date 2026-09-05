import { useEffect, useId, useRef, useState } from 'react';
import { Avatar } from './ui';
import { Icon } from './Icon';
export function AccountMenu({
  name,
  onSignOut,
  onConnections,
}: {
  name: string;
  onSignOut: () => void;
  onConnections: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div
      className="account-control"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
        }
        if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const items = Array.from(
            root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
          );
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          items[
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? items.length - 1
                : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          ]?.focus();
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      {open && (
        <div className="account-menu" id={menuId} role="menu" aria-label="Account">
          <div className="account-menu-heading">Your account</div>
          <button
            role="menuitem"
            onClick={() => {
              close();
              onConnections();
            }}
          >
            <Icon name="settings" size={18} />
            Connections
          </button>
          <button
            role="menuitem"
            onClick={() => {
              close();
              onSignOut();
            }}
          >
            <Icon name="right" size={18} />
            Sign out
          </button>
        </div>
      )}
      <div className="account-identity">
        <Avatar name={name} />
        <span>
          <strong>{name}</strong>
          <small>Personal account</small>
        </span>
      </div>
      <button
        ref={trigger}
        className="icon-button"
        aria-label="Account options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        <Icon name="more" />
      </button>
    </div>
  );
}
