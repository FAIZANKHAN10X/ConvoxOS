"use client"

import { useCallback, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { formatCurrency } from '@/lib/currency'
import Link from 'next/link'
import { ArrowRight, AlertCircle, Clock, TrendingUp, MessageSquare, UserPlus, DollarSign, Send } from 'lucide-react'
import { loadConversationsSeries } from '@/lib/dashboard/queries'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from '@/lib/dashboard/types'
import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { PipelineDonut } from '@/components/dashboard/pipeline-donut'
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart'
import { ActivityFeed } from '@/components/dashboard/activity-feed'
import { useTranslations } from 'next-intl'

type RangeDays = 7 | 30 | 90

interface DashboardClientProps {
  initialMetrics: MetricsBundle | null
  initialSeries30: ConversationsSeriesPoint[] | null
  initialPipeline: PipelineDonutData | null
  initialResponseTime: ResponseTimeSummary | null
  initialActivity: ActivityItem[] | null
}

export function DashboardClient({
  initialMetrics,
  initialSeries30,
  initialPipeline,
  initialResponseTime,
  initialActivity,
}: DashboardClientProps) {
  const t = useTranslations('Dashboard.page')
  const { defaultCurrency } = useAuth()

  const [metrics] = useState<MetricsBundle | null>(initialMetrics)
  const [pipeline] = useState<PipelineDonutData | null>(initialPipeline)
  const [responseTime] = useState<ResponseTimeSummary | null>(initialResponseTime)
  const [activity] = useState<ActivityItem[] | null>(initialActivity)

  const [range, setRange] = useState<RangeDays>(30)
  const [series, setSeries] = useState<Record<RangeDays, ConversationsSeriesPoint[] | null>>({
    7: null,
    30: initialSeries30,
    90: null,
  })
  const [seriesLoading, setSeriesLoading] = useState(false)

  const handleRangeChange = useCallback(
    (r: RangeDays) => {
      setRange(r)
      if (series[r] !== null) return
      setSeriesLoading(true)
      const db = createClient()
      loadConversationsSeries(db, r)
        .then((s) => setSeries((prev) => ({ ...prev, [r]: s })))
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false))
    },
    [series],
  )

  const activeConvCount = metrics?.activeConversations.current ?? 0
  const openDealsCount = metrics?.openDealsCount ?? 0
  const openDealsValue = metrics?.openDealsValue ?? 0

  return (
    <div className="space-y-4">
      {/* Header with compact title & live operational status */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">{t('title')}</h1>
          <p className="text-xs text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
          <span className="tabular-nums">Live telemetry active</span>
        </div>
      </div>

      {/* 1. Compact KPI Ribbon */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!metrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t('activeConversations')}
              value={metrics.activeConversations.current.toLocaleString()}
              icon={MessageSquare}
              delta={{
                sign: metrics.activeConversations.previous,
                label: deltaLabel(metrics.activeConversations.previous, t('newTodayVsYesterday'), t('noChange', { suffix: t('newTodayVsYesterday') })),
              }}
            />
            <MetricCard
              title={t('newContactsToday')}
              value={metrics.newContactsToday.current.toLocaleString()}
              icon={UserPlus}
              delta={{
                sign: metrics.newContactsToday.current - metrics.newContactsToday.previous,
                label: deltaLabel(metrics.newContactsToday.current - metrics.newContactsToday.previous, t('vsYesterday'), t('noChange', { suffix: t('vsYesterday') })),
              }}
            />
            <MetricCard
              title={t('openDealsValue')}
              value={formatCurrency(metrics.openDealsValue, defaultCurrency)}
              icon={DollarSign}
              subtitle={t('openDeals', { count: metrics.openDealsCount })}
            />
            <MetricCard
              title={t('messagesSentToday')}
              value={metrics.messagesSentToday.current.toLocaleString()}
              icon={Send}
              delta={{
                sign: metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                label: deltaLabel(metrics.messagesSentToday.current - metrics.messagesSentToday.previous, t('vsYesterday'), t('noChange', { suffix: t('vsYesterday') })),
              }}
            />
          </>
        )}
      </div>

      {/* 2. Priority Action Cockpit ("What Needs Attention Now") */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href="/inbox"
          className="group flex items-center justify-between rounded-lg border border-border/70 bg-card p-3 shadow-xs transition-colors hover:border-border hover:bg-muted/40"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-500">
              <AlertCircle className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Action Required</p>
              <p className="truncate text-xs font-medium text-foreground">
                <span className="tabular-nums font-semibold text-primary">{activeConvCount}</span> open conversation{activeConvCount === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>

        <Link
          href="/pipelines"
          className="group flex items-center justify-between rounded-lg border border-border/70 bg-card p-3 shadow-xs transition-colors hover:border-border hover:bg-muted/40"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Active Deals</p>
              <p className="truncate text-xs font-medium text-foreground">
                <span className="tabular-nums font-semibold">{openDealsCount}</span> deals · <span className="tabular-nums font-semibold">{formatCurrency(openDealsValue, defaultCurrency)}</span>
              </p>
            </div>
          </div>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>

        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-card p-3 shadow-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
              <Clock className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">SLA Target</p>
              <p className="truncate text-xs font-medium text-foreground">
                Response Target <span className="text-emerald-500 font-semibold">&lt; 5m</span>
              </p>
            </div>
          </div>
          <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </div>
      </div>

      {/* 3. Quick Actions */}
      <QuickActions />

      {/* 4. Main Operational Split (Conversations Chart + Live Event Feed) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div className="h-full lg:col-span-3">
          <ConversationsChart series={series} loading={seriesLoading} range={range} onRangeChange={handleRangeChange} />
        </div>
        <div className="h-full lg:col-span-2">
          <ActivityFeed items={activity} loading={!activity} />
        </div>
      </div>

      {/* 5. Pipeline Analytics & Response Time Breakdown */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div className="h-full lg:col-span-2">
          <PipelineDonut data={pipeline} loading={!pipeline} currency={defaultCurrency} />
        </div>
        <div className="h-full lg:col-span-3">
          <ResponseTimeChart data={responseTime} loading={!responseTime} />
        </div>
      </div>
    </div>
  )
}

function deltaLabel(delta: number, suffix: string, noChangeLabel: string): string {
  if (delta === 0) return noChangeLabel
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString()} ${suffix}`
}
