import { z } from 'zod';

export const jobPriorityLevelValues = ['critical', 'high', 'normal', 'low', 'background'] as const;
export const jobPriorityLevelSchema = z.enum(jobPriorityLevelValues);

export type JobPriorityLevel = z.infer<typeof jobPriorityLevelSchema>;

export interface BrokerPolicyJobCandidate {
  readonly id: string;
  readonly priority: JobPriorityLevel;
  readonly readyAt: string;
  readonly createdAt: string;
}

export interface BrokerPolicyEngine {
  orderClaimCandidates<T extends BrokerPolicyJobCandidate>(candidates: readonly T[]): T[];
}

const priorityRank: Readonly<Record<JobPriorityLevel, number>> = {
  critical: 5,
  high: 4,
  normal: 3,
  low: 2,
  background: 1,
};

export function createBrokerPolicyEngine(): BrokerPolicyEngine {
  return new DefaultBrokerPolicyEngine();
}

class DefaultBrokerPolicyEngine implements BrokerPolicyEngine {
  orderClaimCandidates<T extends BrokerPolicyJobCandidate>(candidates: readonly T[]): T[] {
    return candidates
      .map((candidate) => ({ ...candidate, priority: jobPriorityLevelSchema.parse(candidate.priority) }))
      .sort(comparePolicyCandidates) as T[];
  }
}

function comparePolicyCandidates(left: BrokerPolicyJobCandidate, right: BrokerPolicyJobCandidate): number {
  const priorityDelta = priorityRank[right.priority] - priorityRank[left.priority];

  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const readyAtDelta = Date.parse(left.readyAt) - Date.parse(right.readyAt);

  if (readyAtDelta !== 0) {
    return readyAtDelta;
  }

  return Date.parse(left.createdAt) - Date.parse(right.createdAt);
}
