"use client";

import type { Deal, PipelineStage } from "@/types";
import { Calendar, Check, X } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useNow } from "@/hooks/use-now";
import { useTranslations } from "next-intl";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const contactLabel = deal.contact?.name || deal.contact?.phone || t("noContact");
  const assigneeLabel = deal.assignee?.full_name || null;

  // Stale detection: deal is open and updated_at was > 7 days ago.
  // Wall-clock reads via useNow (null on prerender) so the badge
  // never differs between server HTML and hydration.
  const now = useNow();
  const isStale =
    now !== null &&
    deal.status === "open" &&
    deal.updated_at &&
    now - new Date(deal.updated_at).getTime() > 7 * 24 * 60 * 60 * 1000;

  return (
    <button
      type="button"
      onClick={(e) => {
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group relative w-full cursor-pointer rounded-lg border border-border/70 bg-card pl-3.5 pr-2.5 py-2.5 text-left shadow-xs transition-colors ${
        isOverlay
          ? "shadow-lg border-border"
          : "hover:border-border hover:bg-muted/40"
      }`}
    >
      {/* 2px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-0.5 rounded-l-lg"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-1.5">
        <h4 className="flex-1 text-xs font-semibold leading-snug text-foreground break-words line-clamp-2">
          {deal.title}
        </h4>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 dark:text-emerald-400">
            <Check className="h-2.5 w-2.5" />
            {t("won")}
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold text-destructive">
            <X className="h-2.5 w-2.5" />
            {t("lost")}
          </span>
        )}
        {isStale && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-400"
            title="No activity for > 7 days"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Stale
          </span>
        )}
      </div>

      {/* Contact row */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted/80 text-[9px] font-semibold text-foreground">
          {initials(deal.contact?.name, deal.contact?.phone ?? undefined)}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">{contactLabel}</span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-1">
        <span className="text-xs font-bold tabular-nums text-foreground">
          {formatCurrency(deal.value, deal.currency)}
        </span>
        {deal.expected_close_date && (
          <span className="flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
            <Calendar className="h-2.5 w-2.5" />
            {formatDate(deal.expected_close_date)}
          </span>
        )}
      </div>

      {assigneeLabel && (
        <div className="mt-1.5 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}
    </button>
  );
}
