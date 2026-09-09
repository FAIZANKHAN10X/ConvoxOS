import { describe, expect, it } from 'vitest';

import { graphFromNodes } from './graph';
import { builtinNodes } from './nodes';
import { NodeRegistry } from './registry';
import { validateGraph } from './validate';

const TAG = '11111111-1111-1111-1111-111111111111';

function registry() {
  const r = new NodeRegistry();
  for (const node of builtinNodes) r.register(node);
  return r;
}

describe('validateGraph', () => {
  it('accepts a linear tag → send graph', () => {
    const issues = validateGraph(
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          {
            id: 's',
            type: 'action.send_text',
            config: { text: 'hi', channel: 'whatsapp' },
          },
        ],
        [{ source: 't', target: 's' }]
      ),
      registry()
    );
    expect(issues).toEqual([]);
  });

  it('rejects unknown node types without an engine switch', () => {
    const issues = validateGraph(
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          { id: 'x', type: 'action.does_not_exist', config: {} },
        ],
        [{ source: 't', target: 'x' }]
      ),
      registry()
    );
    expect(issues.some((i) => i.message.includes('unknown node type'))).toBe(
      true
    );
  });

  it('requires true/false edges on conditions', () => {
    const issues = validateGraph(
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          {
            id: 'c',
            type: 'logic.condition',
            config: { subject: 'event.tag_id', value: TAG },
          },
        ],
        [{ source: 't', target: 'c' }]
      ),
      registry()
    );
    expect(issues.some((i) => i.message.toLowerCase().includes('yes'))).toBe(
      true
    );
  });
});
