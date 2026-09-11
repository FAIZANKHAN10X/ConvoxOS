"use client"

import Link from 'next/link'
import type { Route } from 'next'
import { UserPlus, Briefcase, Radio } from 'lucide-react'
import type { ComponentType } from 'react'

import { useTranslations } from 'next-intl'

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant "create" flow. We deliberately don't try to auto-open any
// modal on the target page — that'd require touching those pages,
// which is out of scope here.
interface Action {
  labelKey: string
  href: Route
  icon: ComponentType<{ className?: string }>
  tint: string
}

const ACTIONS: Action[] = [
  { labelKey: 'newContact', href: '/contacts' as Route, icon: UserPlus, tint: 'text-primary' },
  { labelKey: 'newDeal', href: '/pipelines' as Route, icon: Briefcase, tint: 'text-sky-700 dark:text-sky-400' },
  { labelKey: 'newBroadcast', href: '/broadcasts/new' as Route, icon: Radio, tint: 'text-amber-700 dark:text-amber-400' },
  // NOTE: the old `newAutomation` quick action was retired with the
  // automation engine. It returns with Automations v2 (clean rebuild).
]

export function QuickActions() {
  const t = useTranslations('Dashboard.quickActions')
  
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ACTIONS.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 shadow-xs transition-colors hover:bg-muted/40"
          >
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-muted ${a.tint}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium text-foreground">{t(a.labelKey as string)}</span>
          </Link>
        )
      })}
    </div>
  )
}
