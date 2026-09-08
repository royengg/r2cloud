import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
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
  return (
    <ChoicePicker
      label="Model"
      icon={<CodexLogo />}
      value={value}
      disabled={disabled}
      onChange={onChange}
      options={[
        { value: '', label: 'Codex default' },
        ...models.map((model) => ({ value: model.model, label: model.displayName })),
      ]}
    />
  );
}
export function ThinkingPicker({
  model,
  value,
  onChange,
  disabled,
}: {
  model?: CodexModel;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled: boolean;
}) {
  const options = model?.supportedReasoningEfforts ?? [];
  const name = (value: string) =>
    ({ xhigh: 'Extra high', max: 'Maximum' })[value] ??
    value.charAt(0).toUpperCase() + value.slice(1);
  return (
    <ChoicePicker
      label="Thinking"
      icon={<Icon name="brain" size={17} />}
      value={value}
      disabled={disabled || !options.length}
      onChange={onChange}
      options={[
        {
          value: '',
          label: 'Auto',
          description: model?.defaultReasoningEffort
            ? `Use the model default: ${name(model.defaultReasoningEffort)}`
            : 'Use the model’s default thinking level',
        },
        ...options.map((option) => ({
          value: option.reasoningEffort,
          label: name(option.reasoningEffort),
          description: option.description,
        })),
      ]}
    />
  );
}
function ChoicePicker({
  label: setting,
  icon,
  value,
  onChange,
  disabled,
  options,
}: {
  label: string;
  icon: ReactNode;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled: boolean;
  options: { value: string; label: string; description?: string }[];
}) {
  const label = options.find((option) => option.value === (value ?? ''))?.label ?? value;
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
        aria-label={`${setting}, ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        {icon}
        <span>{label}</span>
        <Icon name="down" size={16} />
      </button>
      {open && (
        <div className="model-menu" id={menuId} role="menu" aria-label={setting}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === (value ?? '')}
              tabIndex={-1}
              title={option.description}
              onClick={() => {
                close();
                if (option.value !== (value ?? '')) onChange(option.value || null);
              }}
            >
              <span>{option.label}</span>
              {option.value === (value ?? '') && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
