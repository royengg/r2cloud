import { CodexLogo } from './CodexLogo';
import { useState } from 'react';
import { type Task, columnFor, canMoveTask } from '../lib/types';
import { Icon } from './Icon';
import { Avatar, IconButton, Status } from './ui';
export function Board({
  tasks,
  allTasks,
  onSelect,
  onAskAgent,
  selectedTaskId,
  onCreate,
  canCreate,
  filtered,
  userId,
  manager,
  busy,
  onMove,
}: {
  tasks: Task[];
  allTasks: Task[];
  onSelect: (id: string) => void;
  onAskAgent: (id: string) => void;
  selectedTaskId?: string;
  onCreate: () => void;
  canCreate: boolean;
  filtered: boolean;
  userId: string;
  manager: boolean;
  busy: boolean;
  onMove: (task: Task, status: 'todo' | 'ongoing') => void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [mobileColumn, setMobileColumn] = useState('todo');
  const columns = [
    { id: 'todo', name: 'Todo', icon: 'flag' as const },
    { id: 'ongoing', name: 'Ongoing', icon: 'clock' as const },
    { id: 'completed', name: 'Completed', icon: 'complete' as const },
  ];
  return (
    <>
      <div className="mobile-columns" aria-label="Choose board column">
        {columns.map((c) => (
          <button
            key={c.id}
            aria-pressed={mobileColumn === c.id}
            onClick={() => setMobileColumn(c.id)}
          >
            {c.name}
            <span>{tasks.filter((t) => columnFor(t) === c.id).length}</span>
          </button>
        ))}
      </div>
      <div className="board-grid" aria-label="Project task board">
        {columns.map((c) => {
          const group = tasks.filter((t) => columnFor(t) === c.id);
          return (
            <section
              key={c.id}
              aria-label={c.name}
              data-drop-target={
                dragged &&
                c.id !== 'completed' &&
                tasks.find((t) => t.id === dragged)?.board_status !== c.id
                  ? true
                  : undefined
              }
              onDragOver={(event) => {
                if (dragged && !busy && c.id !== 'completed') {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const task = tasks.find((t) => t.id === dragged);
                setDragged(null);
                if (
                  !busy &&
                  task &&
                  c.id !== 'completed' &&
                  task.board_status !== c.id &&
                  canMoveTask(task, userId, manager)
                )
                  onMove(task, c.id as 'todo' | 'ongoing');
              }}
              className={`board-column column-${c.id} ${mobileColumn === c.id ? 'is-mobile-selected' : ''}`}
            >
              <header className="column-heading">
                <div>
                  <Icon name={c.icon} size={18} />
                  <h2>{c.name}</h2>
                  <span className="column-count">{group.length}</span>
                </div>
                {c.id === 'todo' && canCreate ? (
                  <IconButton name="add" label="Add a task to Todo" onClick={onCreate} />
                ) : (
                  <span className="column-flourish" aria-hidden="true">
                    ···
                  </span>
                )}
              </header>
              <div className="column-cards">
                {group.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    index={allTasks.findIndex((t) => t.id === task.id)}
                    onSelect={() => onSelect(task.id)}
                    onAskAgent={canCreate ? () => onAskAgent(task.id) : undefined}
                    selected={selectedTaskId === task.id}
                    dragging={dragged === task.id}
                    draggable={!busy && canCreate && canMoveTask(task, userId, manager)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', task.id);
                      event.dataTransfer.effectAllowed = 'move';
                      const card = event.currentTarget.closest('.task-card-container')!;
                      const bounds = card.getBoundingClientRect();
                      const preview = card.cloneNode(true) as HTMLElement;
                      preview.classList.add('task-drag-preview');
                      preview.setAttribute('aria-hidden', 'true');
                      preview.style.width = `${bounds.width}px`;
                      preview.style.left = `${bounds.left}px`;
                      preview.style.top = `${bounds.top}px`;
                      document.body.append(preview);
                      event.dataTransfer.setDragImage(
                        preview,
                        event.clientX - bounds.left,
                        event.clientY - bounds.top,
                      );
                      requestAnimationFrame(() => preview.remove());
                      setDragged(task.id);
                    }}
                    onDragEnd={() => setDragged(null)}
                  />
                ))}
                {group.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-drawing" aria-hidden="true">
                      <span className="empty-page">
                        <Icon name={c.icon} size={27} />
                        <i />
                        <i />
                      </span>
                      <span className="empty-orbit" />
                    </div>
                    <strong>
                      {filtered
                        ? 'No matching tasks'
                        : c.id === 'todo'
                          ? 'No tasks yet'
                          : c.id === 'ongoing'
                            ? 'No tasks in progress'
                            : 'No completed tasks'}
                    </strong>
                    <p>
                      {filtered
                        ? 'Try another search or filter.'
                        : c.id === 'todo'
                          ? 'Create a task to add it to the board.'
                          : c.id === 'ongoing'
                            ? 'Start a task to move it here.'
                            : 'Merged tasks appear here.'}
                    </p>
                  </div>
                )}
              </div>
              {c.id === 'todo' && canCreate && (
                <button className="add-card" onClick={onCreate}>
                  <Icon name="add" size={18} />
                  Add a task
                </button>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
function TaskCard({
  task,
  index,
  onSelect,
  onAskAgent,
  selected,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  index: number;
  onSelect: () => void;
  onAskAgent?: () => void;
  selected: boolean;
  draggable: boolean;
  dragging: boolean;
  onDragStart: React.DragEventHandler<HTMLButtonElement>;
  onDragEnd: () => void;
}) {
  const activeRun =
    task.agent ||
    (task.run && !task.run.stopped_at && ['queued', 'running'].includes(task.run.state));
  const model =
    (task.agent?.model ?? task.run?.manifest.thread?.model)
      ?.replace(/^gpt-/, 'GPT-')
      .replace(/-([a-z])/g, (_, letter: string) => `-${letter.toUpperCase()}`) ?? 'Codex';
  const done = task.candidate?.evidence.checks.filter((c) => c.status === 'passed').length ?? 0;
  return (
    <div
      className={`task-card-container ${selected ? 'is-chat-selected' : ''}`}
      data-dragging={dragging || undefined}
    >
      <button
        className="task-card"
        onClick={onSelect}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="task-card-top">
          <span className={`priority-label priority-${task.priority.toLowerCase()}`}>
            <span className="priority-bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {task.priority}
          </span>
          <span className="task-number">{String(index + 1).padStart(2, '0')}</span>
        </div>
        <h3>{task.title}</h3>
        {activeRun ? (
          <div className="card-agent-running">
            <span className="card-agent-label">
              <CodexLogo />
              <span>
                {model} ·{' '}
                {task.agent?.state === 'waiting'
                  ? 'Needs your reply'
                  : (task.agent?.state ?? task.run?.state) === 'queued'
                    ? 'Queued'
                    : 'Running'}
              </span>
            </span>
            {(task.agent?.threadTitle ?? task.run?.thread_title) && (
              <span
                className="card-agent-thread"
                title={task.agent?.threadTitle ?? task.run?.thread_title ?? undefined}
              >
                <Icon name="message" size={13} />
                {task.agent?.threadTitle ?? task.run?.thread_title}
              </span>
            )}
          </div>
        ) : (
          (task.state !== 'todo' || task.board_status === 'ongoing') && (
            <Status state={task.state === 'todo' ? 'building' : task.state} />
          )
        )}
        <div className="task-card-bottom">
          <span className="task-assignee">
            {task.assignee_name ? (
              <>
                <Avatar name={task.assignee_name} size="small" />
                <span>{task.assignee_name.split(' ')[0]}</span>
              </>
            ) : (
              <>
                <span className="unassigned-avatar">
                  <Icon name="person" size={14} />
                </span>
                <span>Unassigned</span>
              </>
            )}
          </span>
          <span
            className="card-evidence"
            title={`${done} of ${task.criteria.length} criteria checked${task.candidate?.manifest.fixture ? ' (fixture)' : ''}`}
          >
            <Icon name="complete" size={15} />
            {done}/{task.criteria.length}
          </span>
          {task.run && !activeRun && (
            <span className="agent-dot" title="Agent implementation">
              <CodexLogo />
              <span className="sr-only">Agent</span>
            </span>
          )}
        </div>
        {activeRun && (task.agent?.state ?? task.run?.state) === 'running' && (
          <div className="run-indicator">
            <span />
          </div>
        )}
      </button>
      {onAskAgent && (
        <IconButton
          name="message"
          label={`Ask agent about ${task.title}`}
          className="task-ask-agent"
          aria-pressed={selected}
          onClick={onAskAgent}
        />
      )}
    </div>
  );
}
