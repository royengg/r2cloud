import { z } from 'zod';
export const taskInput = z
  .object({
    title: z.string().trim().min(3).max(160),
    outcome: z.string().trim().min(3).max(8000),
    criteria: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    priority: z.enum(['High', 'Medium', 'Low']).default('Medium'),
  })
  .strict();
export const commandInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('start'),
      version: z.number().int().positive(),
      minutes: z.number().int().min(1).max(60).default(10),
      budgetCents: z.number().int().min(0).max(5000).default(0),
    })
    .strict(),
  z
    .object({
      action: z.literal('changes'),
      version: z.number().int().positive(),
      feedback: z.string().trim().min(3).max(8000),
    })
    .strict(),
  z
    .object({
      action: z.literal('publish'),
      version: z.number().int().positive(),
      candidateId: z.string().min(1),
      digest: z.string().length(64),
    })
    .strict(),
  z
    .object({
      action: z.literal('merge'),
      version: z.number().int().positive(),
      candidateId: z.string().min(1),
      digest: z.string().length(64),
    })
    .strict(),
]);
export const batchInput = z
  .object({
    tasks: z
      .array(
        z
          .object({ taskId: z.string().min(1).max(100), version: z.number().int().positive() })
          .strict(),
      )
      .min(1)
      .max(10),
    minutesPerTask: z.number().int().min(1).max(60),
    budgetCentsPerTask: z.number().int().min(0).max(5000),
    maxTotalBudgetCents: z.number().int().min(0).max(50000),
  })
  .strict()
  .refine(
    (input) => new Set(input.tasks.map((t) => t.taskId)).size === input.tasks.length,
    'Each task may appear only once.',
  );
export type BatchInput = z.infer<typeof batchInput>;
export type Command = z.infer<typeof commandInput>;
export type TaskInput = z.infer<typeof taskInput>;
export type Actor = { id: string; kind: 'human' | 'agent' };
export class Fault extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireThat(value: unknown, status: number, message: string): asserts value {
  if (!value) throw new Fault(status, message);
}
export type CandidateManifest = {
  orgId: string;
  projectId: string;
  taskId: string;
  runId: string;
  generation: number;
  repository: string;
  targetRef: string;
  branch: string;
  baseSha: string;
  headSha: string;
  artifactDigest: string;
  summary: string;
  limitations: string[];
  fixture: boolean;
};
export type Evidence = {
  checks: { name: string; status: 'passed' | 'failed' | 'unknown' }[];
  snapshotDigest: string;
  preview: { available: boolean; fixture: boolean };
};
