import { CodexLogo } from './CodexLogo';
import { useState } from 'react';
import { type Task, columnFor } from '../lib/types';
import { Icon } from './Icon';
import { Avatar, IconButton, Status } from './ui';
export function Board({
  tasks,
  allTasks,
  onSelect,
  onCreate,
  canCreate,
  filtered,
}: {
  tasks: Task[];
  allTasks: Task[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  canCreate: boolean;
  filtered: boolean;
}) {
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
                          ? 'A little room for a new idea'
                          : c.id === 'ongoing'
                            ? 'Ready when you are'
                            : 'Good things take shape here'}
                    </strong>
                    <p>
                      {filtered
                        ? 'Try another search or filter.'
                        : c.id === 'todo'
                          ? 'Add the next outcome.'
                          : c.id === 'ongoing'
                            ? 'Start a task to get things moving.'
                            : 'Tasks arrive after a verified merge.'}
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
function TaskCard({ task, index, onSelect }: { task: Task; index: number; onSelect: () => void }) {
  const activeRun =
    task.run && !task.run.stopped_at && ['queued', 'running'].includes(task.run.state);
  const model =
    task.run?.manifest.thread?.model
      ?.replace(/^gpt-/, 'GPT-')
      .replace(/-([a-z])/g, (_, letter: string) => `-${letter.toUpperCase()}`) ?? 'Codex';
  const done = task.candidate?.evidence.checks.filter((c) => c.status === 'passed').length ?? 0;
  return (
    <button className="task-card" onClick={onSelect}>
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
              {model} · {task.run?.state === 'queued' ? 'Queued' : 'Running'}
            </span>
          </span>
          {task.run?.thread_title && (
            <span className="card-agent-thread" title={task.run.thread_title}>
              <Icon name="message" size={13} />
              {task.run.thread_title}
            </span>
          )}
        </div>
      ) : (
        task.state !== 'todo' && <Status state={task.state} />
      )}
      <div className="task-card-bottom">
        <span className="task-assignee">
          {task.owner_name ? (
            <>
              <Avatar name={task.owner_name} size="small" />
              <span>{task.owner_name.split(' ')[0]}</span>
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
      {activeRun && task.run?.state === 'running' && (
        <div className="run-indicator">
          <span />
        </div>
      )}
    </button>
  );
}
