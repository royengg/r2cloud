import type { PinnedExecutionProfile } from './execution';
import type { CandidateManifest, Evidence } from './domain';
export type RunGrant = {
  operationId: string;
  runId: string;
  taskId: string;
  projectId: string;
  orgId: string;
  generation: number;
  outcome: string;
  criteria: string[];
  feedback: string[];
  config: {
    thread?: {
      id: string;
      version: number;
      model: string | null;
      instructions: string;
      history: { role: string; body: string }[];
    };
    executionSetup?: PinnedExecutionProfile | null;
    repository: string;
    baseSha: string;
    targetRef: string;
    minutes: number;
    budgetCents: number;
    skills: { id: string; version: string; digest: string }[];
    previousCandidate?: string;
    mode: string;
  };
};
export type RunResult = { manifest: CandidateManifest; evidence: Evidence; stopProof: string };
export type Observation<T> =
  | { state: 'absent' }
  | { state: 'unknown' }
  | { state: 'running' }
  | { state: 'finished'; result: T };
export interface ExecutionBackend {
  readonly mode: 'fixture' | 'managed';
  observe(operationId: string): Promise<Observation<RunResult>>;
  start(grant: RunGrant): Promise<RunResult>;
}
export type PublicationResult = {
  prNumber: number;
  url: string;
  headSha: string;
  repository: string;
  targetRef: string;
  branch: string;
};
export type MergeResult = PublicationResult & {
  merged: boolean;
  mergeSha: string | null;
  requiredChecksPassed: boolean;
};
export type PublicationGrant = {
  operationId: string;
  candidate: CandidateManifest;
  digest: string;
  action: 'publish' | 'merge';
  publication?: PublicationResult;
};
// Only the isolated publisher process receives this adapter. Runner/API constructors do not accept it.
export interface PublisherBackend {
  readonly mode: 'fixture' | 'github';
  observe(grant: PublicationGrant): Promise<Observation<PublicationResult | MergeResult>>;
  publish(grant: PublicationGrant): Promise<PublicationResult>;
  merge(grant: PublicationGrant): Promise<MergeResult>;
}
export class Uncertain extends Error {}
export class SetupRequired extends Error {}

export type DiscoveredRepository = {
  id: number;
  installationId: number;
  fullName: string;
  defaultBranch: string;
  baseSha: string;
};
export interface RepositoryDiscovery {
  discover(input: {
    code: string;
    verifier: string;
    githubUserId: string;
  }): Promise<DiscoveredRepository[]>;
}
