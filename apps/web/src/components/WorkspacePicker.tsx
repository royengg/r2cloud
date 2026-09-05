import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';

export function WorkspacePicker({
  workspaces,
  selectedId,
  onSelect,
}: {
  workspaces: { id: string; name: string }[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const selected = workspaces.find((w) => w.id === selectedId) ?? workspaces[0];
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
      className="workspace-picker"
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
        className="org-picker"
        ref={trigger}
        aria-label={`Switch workspace, ${selected?.name ?? 'Workspace'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className="org-avatar" aria-hidden="true">
          {selected?.name[0]?.toUpperCase() ?? 'W'}
        </span>
        <span className="workspace-picker-copy">
          <span className="field-overline">Workspace</span>
          <strong>{selected?.name ?? 'Choose workspace'}</strong>
        </span>
        <Icon name="down" size={16} />
      </button>
      {open && (
        <div className="workspace-menu" id={menuId} role="menu" aria-label="Workspaces">
          <div className="workspace-menu-heading" role="presentation">
            Your workspaces
          </div>
          <div className="workspace-menu-options" role="presentation">
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                role="menuitemradio"
                aria-checked={workspace.id === selected?.id}
                tabIndex={-1}
                onClick={() => {
                  close();
                  if (workspace.id !== selected?.id) onSelect(workspace.id);
                }}
              >
                <span className="org-avatar" aria-hidden="true">
                  {workspace.name[0]?.toUpperCase()}
                </span>
                <span className="workspace-option-name">{workspace.name}</span>
                {workspace.id === selected?.id && <Icon name="check" size={17} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
