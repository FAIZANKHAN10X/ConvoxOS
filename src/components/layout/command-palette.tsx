'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  GitBranch,
  Radio,
  Zap,
  Bot,
  Bell,
  Settings,
  Search,
  ArrowRight,
  PlusCircle,
  Hash,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface CommandItem {
  id: string;
  label: string;
  category: 'Navigation' | 'Actions';
  href: string;
  icon: typeof LayoutDashboard;
}

const COMMANDS: CommandItem[] = [
  { id: 'dash', label: 'Dashboard', category: 'Navigation', href: '/dashboard', icon: LayoutDashboard },
  { id: 'inbox', label: 'Inbox', category: 'Navigation', href: '/inbox', icon: MessageSquare },
  { id: 'contacts', label: 'Contacts', category: 'Navigation', href: '/contacts', icon: Users },
  { id: 'pipelines', label: 'Pipelines & Deals', category: 'Navigation', href: '/pipelines', icon: GitBranch },
  { id: 'automations', label: 'Automations', category: 'Navigation', href: '/automations', icon: Zap },
  { id: 'broadcasts', label: 'Broadcasts', category: 'Navigation', href: '/broadcasts', icon: Radio },
  { id: 'agents', label: 'AI Agents', category: 'Navigation', href: '/agents', icon: Bot },
  { id: 'notifications', label: 'Notifications', category: 'Navigation', href: '/notifications', icon: Bell },
  { id: 'settings', label: 'Settings', category: 'Navigation', href: '/settings', icon: Settings },
  { id: 'settings-channels', label: 'Channels Settings', category: 'Navigation', href: '/settings?tab=channels', icon: Hash },
  { id: 'new-contact', label: 'New Contact', category: 'Actions', href: '/contacts', icon: PlusCircle },
  { id: 'new-deal', label: 'New Deal', category: 'Actions', href: '/pipelines', icon: PlusCircle },
  { id: 'new-automation', label: 'New Automation Flow', category: 'Actions', href: '/automations', icon: PlusCircle },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    );
  }, [query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  const selectItem = useCallback(
    (item: CommandItem) => {
      onOpenChange(false);
      setQuery('');
      router.push(item.href as any);
    },
    [router, onOpenChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev <= 0 ? (filtered.length || 1) - 1 : prev - 1
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          selectItem(filtered[selectedIndex]);
        }
      }
    },
    [filtered, selectedIndex, selectItem]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg border-border/70 bg-popover text-popover-foreground">
        <DialogHeader className="sr-only">
          <DialogTitle>Command Palette</DialogTitle>
        </DialogHeader>
        <div className="flex items-center border-b border-border/70 px-3 py-2.5">
          <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="h-7 border-0 bg-transparent p-0 text-sm placeholder:text-muted-foreground focus-visible:ring-0 shadow-none"
            autoFocus
          />
          <kbd className="hidden sm:inline-flex rounded border border-border/80 bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            ESC
          </kbd>
        </div>

        <div className="max-h-[320px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No matching commands found.
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((item, index) => {
                const isSelected = index === selectedIndex;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectItem(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors',
                      isSelected
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-foreground hover:bg-muted/60'
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                      <span>{item.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {item.category}
                      </span>
                    </div>
                    {isSelected && (
                      <ArrowRight className="h-3 w-3 shrink-0 opacity-70" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
