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
  trigger: '#3a4150',
  communication: '#2f6fed',
  crm: '#f59e0b',
  logic: '#7c3aed',
  timing: '#0d9488',
};
