'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

/**
 * Account tag id → name lookup shared by the canvas (node summaries)
 * and the config panel (tag selects). Summaries must never render raw
 * database UUIDs; this is the single resolution point.
 */
export function useTagNames(): Record<string, string> {
  const [tagNames, setTagNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from('tags')
      .select('id, name')
      .order('name')
      .then(({ data }) => {
        const map: Record<string, string> = {};
        for (const tag of (data as Array<{ id: string; name: string }>) ??
          []) {
          map[tag.id] = tag.name;
        }
        setTagNames(map);
      });
  }, []);

  return tagNames;
}
