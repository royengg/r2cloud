import { IconButton } from './ui';
import { SkillTextarea } from './SkillTextarea';
import type { Skill } from '@r2cloud/contracts/skills';
import { useRef, useState, type FormEvent, type Ref } from 'react';
import { api } from '../lib/api';
import { refreshRead } from '../lib/realtime';
import { useQuery } from '@tanstack/react-query';
import type { CodexModel } from '@r2cloud/contracts/threads';
import { readQuery } from '../lib/queries';
import { ModelPicker, ThinkingPicker } from './ModelPicker';
import { Icon } from './Icon';
import type { Project, Task } from '../lib/types';
export function Composer({
  project,
  onOpen,
  task,
  inputRef,
  onClearTask,
}: {
  project: Project;
  task?: Task;
  inputRef: Ref<HTMLTextAreaElement>;
  onClearTask: () => void;
  onOpen: (threadId: string) => void;
}) {
  const [text, setText] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const path = `/projects/${project.id}/threads`;
  const catalogue = useQuery(readQuery<{ models: CodexModel[]; skills: Skill[] }>(path));
  const models = catalogue.data?.models ?? [];
  const modelInfo = model
    ? models.find((option) => option.model === model)
    : models.find((option) => option.isDefault);
  const selectedEffort = modelInfo?.supportedReasoningEfforts?.some(
    (option) => option.reasoningEffort === effort,
  )
    ? effort
    : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (sending.current || !text.trim() || !project.contribute) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const thread = await api<{ id: string }>(path, {
        action: 'create',
        title: text.trim().replace(/\s+/g, ' ').slice(0, 80),
        model,
        reasoningEffort: selectedEffort,
        instructions: '',
        taskId: task?.id ?? null,
        body: text.trim(),
      });
      onOpen(thread.id);
      void refreshRead(path);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="composer-area">
      <form className="project-composer" onSubmit={send}>
        <div className="composer-context">
          <span className="composer-mark">
            <Icon name="message" size={20} />
          </span>
          <label htmlFor="project-message">A thought, a question, a next step.</label>
          <span className="composer-scope">
            <Icon name="globe" size={14} />
            Project<span className="scope-separator">/</span>
            {project.name}
          </span>
        </div>
        {task && (
          <div className="composer-task-chip" role="status">
            <Icon name="flag" size={15} />
            <span title={task.title}>{task.title}</span>
            <IconButton
              name="close"
              label="Remove selected task"
              disabled={busy}
              onClick={onClearTask}
            />
          </div>
        )}
        <SkillTextarea
          ref={inputRef}
          id="project-message"
          rows={2}
          placeholder="What would you like to work on?"
          value={text}
          onChange={setText}
          skills={catalogue.data?.skills ?? []}
          disabled={busy || !project.contribute}
          maxLength={8000}
        />
        <div className="composer-actions">
          <div className="thread-settings">
            <ModelPicker
              models={models}
              value={model}
              onChange={(value) => {
                setModel(value);
                setEffort(null);
              }}
              disabled={busy || !project.contribute || catalogue.isPending || catalogue.isError}
            />
            <ThinkingPicker
              model={modelInfo}
              value={selectedEffort}
              onChange={setEffort}
              disabled={busy || !project.contribute}
            />
          </div>
          <button
            className="composer-send"
            type="submit"
            aria-label="Send message"
            aria-busy={busy}
            disabled={busy || !project.contribute || !text.trim()}
          >
            <Icon name={busy ? 'loading' : 'up'} size={21} />
          </button>
        </div>
      </form>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
