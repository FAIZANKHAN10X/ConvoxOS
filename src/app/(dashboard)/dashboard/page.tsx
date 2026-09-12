import { Suspense } from 'react'
import { getCurrentAccount } from '@/lib/auth/account'
import { Skeleton, SkeletonCard } from '@/components/dashboard/skeleton'
import { DashboardSections } from './dashboard-sections'

// Server-first hybrid: data loads via RSC (single Supabase hop,
// streamed HTML, no client waterfall). Interactive islands (range
// toggle, derived UI) live in DashboardClient.
//
// T2.2 streaming: the five loaders are kicked off together but NOT
// awaited — each promise flows to its own section inside
// DashboardClient, where React 19 `use()` suspends only that
// section's boundary. Per-loader .catch preserves the null →
// skeleton contract.
//
// Prerender safety: wall-clock reads live inside DashboardSections
// (below the Suspense boundary), never in this shell path —
// reading the clock here would trip Next.js blocking-prerender
// validation. Identity (cookies) is read here; it suspends cleanly,
// unlike the clock.
export default async function DashboardPage() {
  const { accountId } = await getCurrentAccount()

  return (
    <Suspense fallback={<DashboardPageSkeleton />}>
      <DashboardSections accountId={accountId} />
    </Suspense>
  )
}

function DashboardPageSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-1 h-3 w-64" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Skeleton className="h-[260px] w-full" />
        </div>
        <div className="lg:col-span-2">
          <Skeleton className="h-[260px] w-full" />
        </div>
      </div>
    </div>
  )
}
