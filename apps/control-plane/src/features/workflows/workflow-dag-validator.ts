const supportedStepTypes = new Set([
  'job',
  'wait_signal',
  'approval',
  'timer',
  'pause',
  'join',
  'completion',
]);

interface WorkflowGraphNode {
  readonly id: string;
  readonly type?: string;
}

interface WorkflowGraphEdge {
  readonly from: string;
  readonly to: string;
}

export class WorkflowGraphValidationError extends Error {
  constructor(readonly details: readonly string[]) {
    super(`Invalid workflow graph: ${details.join('; ')}`);
    this.name = 'WorkflowGraphValidationError';
  }
}

export function assertValidWorkflowDag(graph: Record<string, unknown>): void {
  const details: string[] = [];
  const nodes = readNodes(graph.nodes, details);
  const edges = readEdges(graph.edges, details);

  if (details.length > 0) {
    throw new WorkflowGraphValidationError(details);
  }

  const nodeIds = new Set<string>();
  const inboundCounts = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      details.push(`duplicate node id '${node.id}'`);
    }

    nodeIds.add(node.id);
    inboundCounts.set(node.id, 0);
    adjacency.set(node.id, []);

    if (node.type !== undefined && !supportedStepTypes.has(node.type)) {
      details.push(`unsupported step type '${node.type}' on node '${node.id}'`);
    }
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.from)) {
      details.push(`missing node '${edge.from}' referenced by edge from '${edge.from}' to '${edge.to}'`);
      continue;
    }

    if (!nodeIds.has(edge.to)) {
      details.push(`missing node '${edge.to}' referenced by edge from '${edge.from}' to '${edge.to}'`);
      continue;
    }

    adjacency.get(edge.from)?.push(edge.to);
    inboundCounts.set(edge.to, (inboundCounts.get(edge.to) ?? 0) + 1);
  }

  for (const node of nodes) {
    if (node.type === 'join' && (inboundCounts.get(node.id) ?? 0) < 2) {
      details.push(`join step '${node.id}' must have at least two incoming dependencies`);
    }
  }

  const cycle = findCycle(adjacency);

  if (cycle !== null) {
    details.push(`cycle detected: ${cycle.join(' -> ')}`);
  }

  if (details.length > 0) {
    throw new WorkflowGraphValidationError(details);
  }
}

function readNodes(value: unknown, details: string[]): WorkflowGraphNode[] {
  if (!Array.isArray(value)) {
    details.push('nodes must be an array');
    return [];
  }

  return value.flatMap((node, index) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      details.push(`node at index ${index} must be an object`);
      return [];
    }

    const record = node as Record<string, unknown>;

    if (typeof record.id !== 'string' || record.id.trim().length === 0) {
      details.push(`node at index ${index} must have a non-blank string id`);
      return [];
    }

    if (record.type !== undefined && typeof record.type !== 'string') {
      details.push(`node '${record.id}' type must be a string when provided`);
      return [];
    }

    return record.type === undefined
      ? [{ id: record.id }]
      : [{ id: record.id, type: record.type }];
  });
}

function readEdges(value: unknown, details: string[]): WorkflowGraphEdge[] {
  if (!Array.isArray(value)) {
    details.push('edges must be an array');
    return [];
  }

  return value.flatMap((edge, index) => {
    if (edge === null || typeof edge !== 'object' || Array.isArray(edge)) {
      details.push(`edge at index ${index} must be an object`);
      return [];
    }

    const record = edge as Record<string, unknown>;

    if (typeof record.from !== 'string' || record.from.trim().length === 0) {
      details.push(`edge at index ${index} must have a non-blank string from node id`);
      return [];
    }

    if (typeof record.to !== 'string' || record.to.trim().length === 0) {
      details.push(`edge at index ${index} must have a non-blank string to node id`);
      return [];
    }

    return [{ from: record.from, to: record.to }];
  });
}

function findCycle(adjacency: ReadonlyMap<string, readonly string[]>): readonly string[] | null {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  const visit = (nodeId: string): readonly string[] | null => {
    if (visiting.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      return [...path.slice(cycleStart), nodeId];
    }

    if (visited.has(nodeId)) {
      return null;
    }

    visiting.add(nodeId);
    path.push(nodeId);

    for (const next of adjacency.get(nodeId) ?? []) {
      const cycle = visit(next);

      if (cycle !== null) {
        return cycle;
      }
    }

    path.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);

    return null;
  };

  for (const nodeId of adjacency.keys()) {
    const cycle = visit(nodeId);

    if (cycle !== null) {
      return cycle;
    }
  }

  return null;
}
