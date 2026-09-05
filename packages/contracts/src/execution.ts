import { z } from 'zod';
const relativePath = z
  .string()
  .max(200)
  .refine(
    (p) =>
      p === '.' ||
      (/^[a-zA-Z0-9_./-]+$/.test(p) &&
        !p.startsWith('/') &&
        !p.split('/').some((x) => x === '..' || x === '')),
    'Use a relative repository directory.',
  );
const command = z
  .object({
    cmd: z
      .string()
      .regex(/^[a-zA-Z0-9_./-]+$/)
      .max(150),
    args: z
      .array(
        z
          .string()
          .max(1000)
          .refine((s) => !s.includes('\0')),
      )
      .max(40),
  })
  .strict();
export const executionProfile = z
  .object({
    directory: relativePath,
    install: command,
    dev: command,
    tests: z.array(command).min(1).max(10),
    port: z.number().int().min(1024).max(65535),
    healthPath: z
      .string()
      .max(200)
      .regex(/^\/(?!\/)[a-zA-Z0-9/_-]*$/),
    maxMinutes: z.number().int().min(1).max(60),
    maxBudgetCents: z.number().int().min(1).max(10000),
    vcpus: z.union([z.literal(2), z.literal(4)]),
  })
  .strict();
export type ExecutionProfile = z.infer<typeof executionProfile>;
export type PinnedExecutionProfile = { version: number; digest: string; config: ExecutionProfile };
