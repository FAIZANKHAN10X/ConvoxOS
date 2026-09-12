import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Pre-render guard: wall-clock reads inside `use cache` scopes poison
// cache keys and trip Next.js prerender validation ("unstable
// value"). All time boundaries must be computed by callers at
// request time and passed in as plain args.
const root = process.cwd()

describe('cache-scope time hygiene', () => {
  it('queries-cached.ts reads no wall-clock time', () => {
    const src = readFileSync(join(root, 'src/lib/dashboard/queries-cached.ts'), 'utf8')
    expect(src).not.toMatch(/Date\.now\(\)/)
    expect(src).not.toMatch(/new Date\(\)/)
  })

  it('render-path time displays go through useNow (null on prerender)', () => {
    for (const f of [
      'src/components/pipelines/deal-card.tsx',
      'src/components/pipelines/pipeline-analytics.tsx',
      'src/components/dashboard/activity-feed.tsx',
    ]) {
      const src = readFileSync(join(root, f), 'utf8')
      expect(src).toContain('useNow')
    }
    const hook = readFileSync(join(root, 'src/hooks/use-now.ts'), 'utf8')
    expect(hook).toContain('useState<number | null>(null)')
  })
})

describe('shell-path time hygiene (pre-benchmark)', () => {
  it('dashboard page reads no wall-clock time (lives in DashboardSections)', () => {
    const src = readFileSync(join(root, 'src/app/(dashboard)/dashboard/page.tsx'), 'utf8');
    expect(src).not.toMatch(/Date\.now\(\)/);
    expect(src).not.toMatch(/new Date\(\)/);
  });

  it('use-presence initializes its clock to null (populated on mount)', () => {
    const src = readFileSync(join(root, 'src/hooks/use-presence.ts'), 'utf8');
    expect(src).toContain('useState<number | null>(null)');
    expect(src).not.toMatch(/useState\(\(\) => Date\.now\(\)\)/);
  });
});
