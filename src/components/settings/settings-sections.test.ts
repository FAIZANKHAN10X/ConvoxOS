import { describe, it, expect } from 'vitest';
import { resolveSection, SETTINGS_SECTIONS, SECTION_META } from './settings-sections';

describe('settings-sections', () => {
  it('channels is the canonical tab and whatsapp is a legacy alias', () => {
    expect(SETTINGS_SECTIONS).toContain('channels');
    expect(SETTINGS_SECTIONS).not.toContain('whatsapp');
    expect(resolveSection('whatsapp')).toBe('channels');
    expect(resolveSection('channels')).toBe('channels');
  });

  it('channels has workspace grouping and meta', () => {
    expect(SECTION_META.channels.group).toBe('workspace');
    expect(SECTION_META.channels.label).toBe('Channels');
  });

  it('resolveSection preserves legacy tag aliases and falls back to overview', () => {
    expect(resolveSection('tags')).toBe('fields');
    expect(resolveSection('custom-fields')).toBe('fields');
    expect(resolveSection(null)).toBe('overview');
    expect(resolveSection('unknown')).toBe('overview');
  });

  it('overview exposes a channels tile (not whatsapp)', () => {
    expect(SETTINGS_SECTIONS).toContain('overview');
    // whatsapp tile no longer exists as a top-level section
    expect(SECTION_META.channels).toBeDefined();
  });
});
