import { describe, expect, it } from 'vitest';

import { catalogFromRegistry } from './catalog';
import { validateDraftGraph } from './client-validate';
import { starterGraph } from './graph';
import { defaultRegistry } from './registry';
import './nodes';

describe('validateDraftGraph', () => {
  it('asks for a tag on the starter trigger', () => {
    const issues = validateDraftGraph(
      starterGraph(),
      catalogFromRegistry(defaultRegistry)
    );
    expect(issues.some((issue) => issue.message.includes('Tag'))).toBe(true);
  });
});
