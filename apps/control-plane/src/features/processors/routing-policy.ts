import type {
  JobRecord,
  ProcessorRegistryRecord,
  RoutingExplanation,
} from '@helix/contracts';

interface RoutingConstraints {
  readonly capability?: string | undefined;
  readonly version?: string | undefined;
  readonly capabilityVersion?: string | undefined;
  readonly gpu?: boolean | undefined;
  readonly requireGpu?: boolean | undefined;
  readonly memoryMb?: number | undefined;
  readonly minMemoryMb?: number | undefined;
  readonly region?: string | undefined;
  readonly labels?: Record<string, string> | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface RoutingPolicyInput {
  readonly job: Pick<JobRecord, 'constraints'>;
  readonly processor: ProcessorRegistryRecord;
}

export interface RoutingPolicy {
  evaluate(input: RoutingPolicyInput): RoutingExplanation;
}

export class CapabilityRoutingPolicy implements RoutingPolicy {
  evaluate(input: RoutingPolicyInput): RoutingExplanation {
    return evaluateCapabilityRoute(input);
  }
}

export function evaluateCapabilityRoute(input: RoutingPolicyInput): RoutingExplanation {
  const constraints = normalizeConstraints(input.job.constraints);
  const reasons: string[] = [];
  const rejectedConstraints: string[] = [];
  const matchedCapabilities: string[] = [];

  if (constraints.capability !== undefined) {
    const matched = input.processor.capabilities.find(
      (capability) =>
        capability.name === constraints.capability &&
        (constraints.capabilityVersion === undefined || capability.version === constraints.capabilityVersion),
    );

    if (matched === undefined) {
      rejectedConstraints.push(
        constraints.capabilityVersion === undefined
          ? `capability ${constraints.capability} unavailable`
          : `capability ${constraints.capability}@${constraints.capabilityVersion} unavailable`,
      );
    } else {
      matchedCapabilities.push(matched.name);
      reasons.push(`capability ${matched.name}@${matched.version} matched`);
    }
  }

  if (constraints.requireGpu === true || constraints.gpu === true) {
    if (!input.processor.hardware.gpu) {
      rejectedConstraints.push('gpu required');
    } else {
      reasons.push('gpu matched');
    }
  }

  if (constraints.minMemoryMb !== undefined) {
    if (input.processor.hardware.memoryMb < constraints.minMemoryMb) {
      rejectedConstraints.push(`memoryMb ${constraints.minMemoryMb} required`);
    } else {
      reasons.push(`memoryMb ${constraints.minMemoryMb} matched`);
    }
  }

  if (constraints.region !== undefined) {
    if (input.processor.region !== constraints.region) {
      rejectedConstraints.push(`region ${constraints.region} required`);
    } else {
      reasons.push(`region ${constraints.region} matched`);
    }
  }

  for (const [key, value] of Object.entries(constraints.labels ?? {})) {
    if (input.processor.labels[key] !== value) {
      rejectedConstraints.push(`label ${key}=${value} required`);
    } else {
      reasons.push(`label ${key}=${value} matched`);
    }
  }

  for (const tag of constraints.tags ?? []) {
    if (!input.processor.tags.includes(tag)) {
      rejectedConstraints.push(`tag ${tag} required`);
    } else {
      reasons.push(`tag ${tag} matched`);
    }
  }

  return {
    eligible: rejectedConstraints.length === 0,
    reasons: reasons.length === 0 && rejectedConstraints.length === 0 ? ['no routing constraints'] : reasons,
    matchedCapabilities,
    rejectedConstraints,
    metadata: {
      constraintKeys: Object.keys(input.job.constraints).sort(),
      processorId: input.processor.id,
      agentId: input.processor.agentId,
    },
  };
}

function normalizeConstraints(constraints: Record<string, unknown>): RoutingConstraints {
  return {
    capability: asNonBlankString(constraints.capability),
    capabilityVersion: asNonBlankString(constraints.capabilityVersion) ?? asNonBlankString(constraints.version),
    gpu: asBoolean(constraints.gpu),
    requireGpu: asBoolean(constraints.requireGpu),
    memoryMb: asPositiveInteger(constraints.memoryMb),
    minMemoryMb: asPositiveInteger(constraints.minMemoryMb) ?? asPositiveInteger(constraints.memoryMb),
    region: asNonBlankString(constraints.region),
    labels: asStringRecord(constraints.labels),
    tags: asStringArray(constraints.tags),
  };
}

function asNonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );

  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const tags = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

  return tags.length === 0 ? undefined : tags;
}
