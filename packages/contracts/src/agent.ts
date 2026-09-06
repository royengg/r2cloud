import { z } from 'zod';
export const agentInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('respond'),
      requestId: z.string().min(1).max(160),
      answers: z.record(z.string(), z.array(z.string().max(8000)).max(10)).optional(),
      approved: z.boolean().optional(),
    })
    .strict(),
  z.object({ action: z.literal('stop') }).strict(),
]);
export type AgentItem = {
  id: string;
  turnId: string;
  kind: string;
  text: string;
  status: string;
  detail: Record<string, unknown>;
};
export type AgentRequest = {
  id: string;
  kind: string;
  prompt: string;
  detail: Record<string, unknown>;
  resolved: boolean;
};
export type AgentTimeline = {
  cursor: string;
  items: AgentItem[];
  requests: AgentRequest[];
  state: string;
  turnId: string | null;
  actorId: string | null;
};
export type AgentGrant = {
  id: string;
  projectId: string;
  orgId: string;
  threadId: string;
  actorId: string;
  connectionId: string;
  model: string | null;
  instructions: string;
  message: string;
  providerId: string | null;
  providerState: string | null;
  taskId: string | null;
  minutes: number;
};
