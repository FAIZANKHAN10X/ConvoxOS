import { describe, expect, it } from 'vitest';

import { catalogFromRegistry } from './catalog';
import { validateDraftGraph } from './client-validate';
import { starterGraph } from './graph';
import { defaultRegistry } from './registry';
import './nodes';

describe('validateDraftGraph', () => {
  it('asks the starter trigger to connect its Next path', () => {
    const issues = validateDraftGraph(
      starterGraph(),
      catalogFromRegistry(defaultRegistry)
    );
    expect(issues.some((issue) => issue.message.includes('Next'))).toBe(true);
  });
});
