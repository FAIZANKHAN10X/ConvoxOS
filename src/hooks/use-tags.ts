'use client';

import { useEffect, useState } from 'react';

export interface UserTag {
  id: string;
  name: string;
  color?: string;
}

let cached: UserTag[] | null = null;
let inflight: Promise<UserTag[]> | null = null;

async function fetchTags(): Promise<UserTag[]> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/api/tags');
      if (!res.ok) return [];
      const json = (await res.json()) as { tags?: UserTag[] };
      cached = json.tags ?? [];
      return cached;
    } catch {
      return [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useUserTags(): UserTag[] {
  const [tags, setTags] = useState<UserTag[]>(() => cached ?? []);

  useEffect(() => {
    let cancelled = false;
    fetchTags().then((t) => {
      if (!cancelled) setTags(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return tags;
}
