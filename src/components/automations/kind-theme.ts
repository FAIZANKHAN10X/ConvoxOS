import type { CatalogNode } from '@/lib/automation/catalog';
import {
  Clock,
  GitBranch,
  MessageSquare,
  Tag,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export const CATEGORY_LABEL: Record<CatalogNode['category'], string> = {
  trigger: 'Triggers',
  communication: 'Content',
  crm: 'Actions',
  logic: 'Conditions',
  timing: 'Smart Delay',
};

export const CATEGORY_ICON: Record<CatalogNode['category'], LucideIcon> = {
  trigger: Zap,
  communication: MessageSquare,
  crm: Tag,
  logic: GitBranch,
  timing: Clock,
};

/** Visual language is keyed by category/kind, never by node type. */
export const CATEGORY_ACCENT: Record<CatalogNode['category'], string> = {
  trigger: '#16a34a',
  communication: '#2f6fed',
  crm: '#f59e0b',
  logic: '#7c3aed',
  timing: '#0d9488',
};

/**
 * ManyChat-style header band per category. Rendered as the card's
 * header background; body stays white. Keyed by category so new node
 * types inherit the treatment with zero UI changes.
 */
export const CATEGORY_BAND: Record<CatalogNode['category'], string> = {
  trigger: '#f0fdf4',
  communication: '#ffffff',
  crm: '#fef9c3',
  logic: '#ccfbf1',
  timing: '#ffedd5',
};

/** Icon treatment per category: solid circular badge. */
export const CATEGORY_BADGE: Record<CatalogNode['category'], string> = {
  trigger: '#16a34a',
  communication: '#2f6fed',
  crm: '#eab308',
  logic: '#14b8a6',
  timing: '#f97316',
};
