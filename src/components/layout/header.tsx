'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useState, useEffect } from 'react';
import { LogOut, Menu, Settings as SettingsIcon, User, Search } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ModeToggle } from '@/components/layout/mode-toggle';
import { CommandPalette } from '@/components/layout/command-palette';
import { useChannelStatus } from '@/hooks/use-channel-status';

const pageTitles: Record<string, string> = {
  '/dashboard': 'dashboard',
  '/inbox': 'inbox',
  '/notifications': 'notifications',
  '/contacts': 'contacts',
  '/pipelines': 'pipelines',
  '/forms': 'forms',
  '/tasks': 'tasks',
  '/broadcasts': 'broadcasts',
  '/automations': 'automations',
  '/settings': 'settings',
};

function getPageTitleKey(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(path)
  );
  return match ? match[1] : 'dashboard';
}

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

import { useTranslations } from 'next-intl';

export function Header({ onOpenSidebar }: HeaderProps) {
  const t = useTranslations('Header');
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const { whatsappConnected, telegramConnected, loading: channelsLoading } = useChannelStatus();
  const [commandOpen, setCommandOpen] = useState(false);
  const titleKey = getPageTitleKey(pathname);

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    'U';

  return (
    <header className="border-border/60 bg-background flex h-13 shrink-0 items-center justify-between gap-3 border-b px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {/* Hamburger — mobile only. 44×44 hit target per Apple HIG. */}
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label={t('openMenu')}
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-9 w-9 items-center justify-center rounded-md transition-colors lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>
        <h1 className="text-foreground truncate text-sm font-semibold sm:text-base">
          {t(titleKey as string)}
        </h1>

        {/* Global Quick Search / Cmd+K button */}
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="text-muted-foreground hover:border-border hover:bg-muted/50 hidden h-8 items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 text-xs transition-colors md:flex"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search or jump to…</span>
          <kbd className="text-muted-foreground/80 rounded border border-border/70 bg-muted/60 px-1 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>
      </div>

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />

      <div className="flex items-center gap-2 sm:gap-3">
        {/* Channel Health Status */}
        {!channelsLoading && (
          <div className="hidden items-center gap-2 sm:flex">
            {whatsappConnected ? (
              <Link
                href="/settings?tab=channels"
                className="flex items-center gap-1.5 rounded-full border border-emerald-600/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 transition-colors dark:text-emerald-400"
                title="WhatsApp Connected"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span>WA Live</span>
              </Link>
            ) : telegramConnected ? (
              <Link
                href="/settings?tab=channels"
                className="flex items-center gap-1.5 rounded-full border border-sky-600/25 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 transition-colors dark:text-sky-400"
                title="Telegram Connected"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                <span>TG Live</span>
              </Link>
            ) : null}
          </div>
        )}

        <ModeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger
            className="hover:bg-muted/70 focus:bg-muted/70 data-popup-open:bg-muted/70 flex items-center gap-2 rounded-md px-1 py-1 transition-colors focus:outline-none sm:gap-3 sm:pr-3 sm:pl-1"
            aria-label={t('openAccountMenu')}
          >
            <Avatar className="size-8">
              {profile?.avatar_url ? (
                <AvatarImage
                  src={profile.avatar_url}
                  alt={profile.full_name ?? t('defaultAvatar')}
                />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                {initial}
              </AvatarFallback>
            </Avatar>
            <span className="text-foreground hidden text-sm font-medium sm:inline">
              {profile?.full_name ?? t('defaultUser')}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="bg-popover text-popover-foreground ring-border min-w-56"
          >
            <div className="px-2 py-1.5">
              <p className="text-foreground truncate text-sm font-medium">
                {profile?.full_name ?? t('defaultUser')}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {profile?.email ?? ''}
              </p>
            </div>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              render={
                <Link
                  href="/settings?tab=profile"
                  className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                />
              }
            >
              <User className="size-4" />
              {t('menuProfile')}
            </DropdownMenuItem>
            <DropdownMenuItem
              render={
                <Link
                  href="/settings?tab=channels"
                  className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                />
              }
            >
              <SettingsIcon className="size-4" />
              {t('menuSettings')}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={signOut}
              className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
            >
              <LogOut className="size-4" />
              {t('menuSignOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
