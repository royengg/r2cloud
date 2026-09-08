import { z } from 'zod';
export const previewInspection = z
  .object({
    path: z
      .string()
      .max(1000)
      .regex(/^\/(?!\/)[^\\\u0000-\u001f]*$/)
      .default('/'),
    width: z.number().int().min(320).max(1600).default(1280),
    height: z.number().int().min(320).max(1200).default(800),
  })
  .strict();
