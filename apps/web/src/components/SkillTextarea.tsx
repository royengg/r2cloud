import {
  useId,
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';
import type { Skill } from '@r2cloud/contracts/skills';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  skills: Skill[];
  ref?: Ref<HTMLTextAreaElement>;
};

export function SkillTextarea({ value, onChange, skills, ref, ...props }: Props) {
  const field = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => field.current!);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const before = value.slice(0, caret);
  const token = before.match(/(?:^|\s)\/([a-z0-9-]*)$/i);
  const inCode =
    (before.match(/```|~~~/g)?.length ?? 0) % 2 !== 0 ||
    (before.split('\n').at(-1)!.match(/`/g)?.length ?? 0) % 2 !== 0;
  const options =
    token && !inCode
      ? skills.filter(
          (skill) =>
            skill.name.includes(token[1]!.toLowerCase()) ||
            skill.description.toLowerCase().includes(token[1]!.toLowerCase()),
        )
      : [];
  const visible = open && !props.disabled && options.length > 0;
  const index = Math.min(active, options.length - 1);
  useEffect(() => {
    if (visible)
      document.getElementById(`${listId}-${index}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [visible, listId, index]);
  function select(skill: Skill) {
    const start = caret - token![1]!.length - 1;
    const end = caret + (value.slice(caret).match(/^[a-z0-9-]*/i)?.[0].length ?? 0);
    const insertion = `/${skill.name} `;
    onChange(value.slice(0, start) + insertion + value.slice(end));
    setOpen(false);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(start + insertion.length, start + insertion.length);
      setOpen(false);
    });
  }
  return (
    <div className="skill-composer">
      {visible && (
        <div className="skill-menu" id={listId} role="listbox" aria-label="Skills">
          {options.map((skill, i) => (
            <div
              key={skill.name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={index === i}
              onMouseDown={(event) => {
                event.preventDefault();
                select(skill);
              }}
            >
              <strong>/{skill.name}</strong>
              <span>{skill.description}</span>
            </div>
          ))}
        </div>
      )}
      <textarea
        {...props}
        ref={field}
        value={value}
        aria-autocomplete="list"
        aria-controls={visible ? listId : undefined}
        aria-activedescendant={visible ? `${listId}-${index}` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart);
          setActive(0);
          setOpen(true);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (visible && !event.nativeEvent.isComposing) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setActive(
                (index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length,
              );
              return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              select(options[index]!);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              return;
            }
          }
          props.onKeyDown?.(event);
        }}
      />
    </div>
  );
}
