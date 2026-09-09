import type { NodeHandleSpec, NodeKind, NodePorts } from './types';

export const NEXT_HANDLE: NodeHandleSpec = { id: 'default', label: 'Next' };
export const YES_HANDLE: NodeHandleSpec = { id: 'true', label: 'Yes' };
export const NO_HANDLE: NodeHandleSpec = { id: 'false', label: 'No' };

export function defaultPorts(kind: NodeKind): NodePorts {
  if (kind === 'trigger') {
    return { incoming: false, outgoing: [NEXT_HANDLE] };
  }
  if (kind === 'condition') {
    return { incoming: true, outgoing: [YES_HANDLE, NO_HANDLE] };
  }
  return { incoming: true, outgoing: [NEXT_HANDLE] };
}

export function resolvePorts(def: {
  kind: NodeKind;
  ports?: NodePorts;
}): NodePorts {
  return def.ports ?? defaultPorts(def.kind);
}
