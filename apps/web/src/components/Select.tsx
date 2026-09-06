import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';

type Option = { value: string; label: string };
export function Select({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose an option',
  disabled = false,
  required = false,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.findIndex((option) => option.value === value);
  function position() {
    const button = trigger.current;
    const popup = menu.current;
    if (!button || !popup) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 180), innerWidth - 24);
    const below = innerHeight - rect.bottom - 20;
    const above = rect.top - 20;
    popup.style.width = `${width}px`;
    const height = Math.min(popup.scrollHeight, 300);
    const upwards = below < height && above > below;
    const available = Math.max(40, upwards ? above : below);
    Object.assign(popup.style, {
      width: `${width}px`,
      maxHeight: `${Math.min(300, available)}px`,
      left: `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`,
      top: `${upwards ? Math.max(12, rect.top - Math.min(height, available) - 6) : rect.bottom + 6}px`,
    });
  }
  function show(index = Math.max(0, selected)) {
    if (disabled || !options.length) return;
    setActive(index);
    menu.current?.showPopover();
    setOpen(true);
    position();
  }
  function close() {
    menu.current?.hidePopover();
    setOpen(false);
  }
  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    close();
    trigger.current?.focus();
  }
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    position();
    const onScroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) position();
    };
    window.addEventListener('resize', position);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open, options.length]);
  useEffect(() => {
    const popup = menu.current;
    const option = popup?.children[active] as HTMLElement | undefined;
    if (!open || !popup || !option) return;
    if (option.offsetTop < popup.scrollTop) popup.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > popup.scrollTop + popup.clientHeight)
      popup.scrollTop = option.offsetTop + option.offsetHeight - popup.clientHeight;
  }, [active, open]);
  return (
    <div className="select-field">
      <label id={`${id}-label`} htmlFor={`${id}-trigger`}>
        {label}
      </label>
      <button
        id={`${id}-trigger`}
        ref={trigger}
        className="select-trigger"
        type="button"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-haspopup="listbox"
        aria-controls={`${id}-menu`}
        aria-expanded={open}
        aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined}
        aria-required={required || undefined}
        disabled={disabled || !options.length}
        onClick={() => (open ? close() : show())}
        onBlur={close}
        onKeyDown={(event) => {
          const key = event.key;
          if (key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            close();
          } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
            event.preventDefault();
            const index =
              key === 'Home'
                ? 0
                : key === 'End'
                  ? options.length - 1
                  : open
                    ? (active + (key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
                    : selected < 0 && key === 'ArrowUp'
                      ? options.length - 1
                      : Math.max(0, selected);
            if (open) setActive(index);
            else show(index);
          } else if ((key === 'Enter' || key === ' ') && open) {
            event.preventDefault();
            choose(active);
          } else if (
            key.length === 1 &&
            key !== ' ' &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
          ) {
            event.preventDefault();
            const text = Date.now() - search.current.at < 700 ? search.current.text + key : key;
            search.current = { text, at: Date.now() };
            const index = options.findIndex((option) =>
              option.label.toLocaleLowerCase().startsWith(text.toLocaleLowerCase()),
            );
            if (index >= 0) {
              if (open) setActive(index);
              else show(index);
            }
          }
        }}
      >
        <span className={selected < 0 ? 'select-placeholder' : undefined}>
          {options[selected]?.label ?? placeholder}
        </span>
        <Icon name="down" size={16} />
      </button>
      <div
        id={`${id}-menu`}
        ref={menu}
        popover="auto"
        role="listbox"
        aria-labelledby={`${id}-label`}
        className="select-menu"
        onToggle={(event) => setOpen(event.newState === 'open')}
        onPointerDown={(event) => event.preventDefault()}
      >
        {options.map((option, index) => (
          <div
            key={option.value}
            id={`${id}-option-${index}`}
            role="option"
            aria-selected={option.value === value}
            className="select-option"
            data-active={index === active}
            onPointerMove={() => setActive(index)}
            onClick={() => choose(index)}
          >
            <span>{option.label}</span>
            {option.value === value && <Icon name="check" size={16} />}
          </div>
        ))}
      </div>
    </div>
  );
}
