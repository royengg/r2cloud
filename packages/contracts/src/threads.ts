import { z } from 'zod';
export const codexModel = z.object({
  model: z.string().min(1).max(120),
  displayName: z.string().min(1).max(160),
  isDefault: z.boolean().default(false),
});
export const codexModels = z.array(codexModel).max(100);
export type CodexModel = z.infer<typeof codexModel>;
export const threadSettings = z.object({
  title: z.string().trim().min(1).max(160),
  model: z.string().min(1).max(120).nullable().default(null),
  instructions: z.string().trim().max(8000).default(''),
});
export const threadCommand = z.discriminatedUnion('action', [
  threadSettings
    .extend({
      action: z.literal('create'),
      taskId: z.string().min(1).max(100).nullable().default(null),
    })
    .strict(),
  threadSettings
    .extend({ action: z.literal('update'), version: z.number().int().positive() })
    .strict(),
  z.object({ action: z.literal('archive'), version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('message'), body: z.string().trim().min(1).max(8000) }).strict(),
  z
    .object({
      action: z.literal('run'),
      version: z.number().int().positive(),
      taskVersion: z.number().int().positive().optional(),
      body: z.string().trim().min(1).max(8000),
    })
    .strict(),
]);
