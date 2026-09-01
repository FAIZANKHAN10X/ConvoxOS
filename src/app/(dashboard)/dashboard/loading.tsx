import { SkeletonCard } from '@/components/dashboard/skeleton'

export default function Loading() {
  return (
    <div className="space-y-5">
      <div>
        <div className="h-7 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-64 animate-pulse rounded-xl border border-border bg-card lg:col-span-3" />
        <div className="h-64 animate-pulse rounded-xl border border-border bg-card lg:col-span-2" />
      </div>
      <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
      <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
    </div>
  )
}
