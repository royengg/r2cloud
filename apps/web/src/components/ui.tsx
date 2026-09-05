import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';
import { statuses } from '../lib/types';
export function Button({
  children,
  icon,
  variant = 'secondary',
  className = '',
  busy,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'ghost';
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button button-${variant} ${className}`}
    >
      {icon && <Icon name={busy ? 'loading' : icon} size={18} />}
      <span>{children}</span>
    </button>
  );
}
export function IconButton({
  name,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { name: IconName; label: string }) {
  return (
    <button
      {...props}
      className={`icon-button ${props.className ?? ''}`}
      aria-label={label}
      title={label}
    >
      <Icon name={name} />
    </button>
  );
}
export function Avatar({
  name,
  size = 'normal',
  tone = 0,
}: {
  name: string;
  size?: 'small' | 'normal' | 'large';
  tone?: number;
}) {
  return (
    <span className={`avatar avatar-${size} avatar-tone-${tone % 4}`} title={name}>
      {name
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')}
    </span>
  );
}
export function Status({ state }: { state: string }) {
  return (
    <span className={`status status-${state}`}>
      <Icon
        name={
          state === 'completed'
            ? 'complete'
            : state === 'review' || state === 'blocked'
              ? 'attention'
              : state === 'todo'
                ? 'flag'
                : 'clock'
        }
        size={14}
      />
      {statuses[state] ?? state}
    </span>
  );
}
export function Modal({
  children,
  label,
  close,
  className = '',
}: {
  children: ReactNode;
  label: string;
  close: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const cancel = (event: Event) => {
      event.preventDefault();
      closeRef.current();
    };
    dialog.addEventListener('cancel', cancel);
    return () => {
      dialog.removeEventListener('cancel', cancel);
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-label={label}
      onClick={(e) => {
        if (e.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            close();
        }
      }}
    >
      {children}
    </dialog>
  );
}
