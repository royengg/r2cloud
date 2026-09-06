import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';
import { CodexLogo } from './CodexLogo';
import type { CodexModel } from '@r2cloud/contracts/threads';

export function ModelPicker({
  models,
  value,
  onChange,
  disabled,
}: {
  models: CodexModel[];
  value: string | null;
  onChange: (value: string | null) => void;
  disabled: boolean;
}) {
  const options = [{ model: '', displayName: 'Codex default' }, ...models];
  const label = options.find((option) => option.model === (value ?? ''))?.displayName ?? value;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const menu = root.current;
    (
      menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
      menu?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')
    )?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
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
      className="model-picker"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          if (disabled) return;
          if (!open) {
            setOpen(true);
            return;
          }
          const items = Array.from(
            root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
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
    >
      <button
        className="model-picker-trigger"
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-label={`Model, ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        <CodexLogo />
        <span>{label}</span>
        <Icon name="down" size={16} />
      </button>
      {open && (
        <div className="model-menu" id={menuId} role="menu" aria-label="Models">
          {options.map((option) => (
            <button
              key={option.model}
              type="button"
              role="menuitemradio"
              aria-checked={option.model === (value ?? '')}
              tabIndex={-1}
              onClick={() => {
                close();
                if (option.model !== (value ?? '')) onChange(option.model || null);
              }}
            >
              <span>{option.displayName}</span>
              {option.model === (value ?? '') && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
