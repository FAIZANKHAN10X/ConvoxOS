import { describe, it, expect } from 'vitest';

import {
  interpolateTemplate,
  interpolationPathsForGraph,
} from './interpolate';

describe('interpolateTemplate', () => {
  it('resolves dotted paths against the scope', () => {
    expect(
      interpolateTemplate('hi {{contact.name}}, order {{order.id}}', {
        contact: { name: 'Ada' },
        order: { id: 42 },
      })
    ).toBe('hi Ada, order 42');
  });

  it('tolerates whitespace inside braces', () => {
    expect(interpolateTemplate('[{{  a  }}]', { a: 'x' })).toBe('[x]');
  });

  it('renders missing paths as empty strings', () => {
    expect(interpolateTemplate('a{{nope}}b{{x.y.z}}c', {})).toBe('abc');
  });

  it('stringifies objects', () => {
    expect(interpolateTemplate('{{o}}', { o: { a: 1 } })).toBe('{"a":1}');
  });

  it('leaves non-template text untouched', () => {
    expect(interpolateTemplate('{"k":"v"}', {})).toBe('{"k":"v"}');
  });
});

describe('interpolationPathsForGraph', () => {
  it('includes run-context paths and prior node outputs', () => {
    const paths = interpolationPathsForGraph([
      { id: 't', type: 'trigger.tag_added', label: 'Tag added' },
      { id: 'http', type: 'action.http_request', label: 'HTTP request' },
    ]);
    expect(paths.some((item) => item.path === 'contactId')).toBe(true);
    expect(paths.some((item) => item.path === 'outputs.http')).toBe(true);
    expect(paths.some((item) => item.path === 'outputs.t')).toBe(false);
  });
});
