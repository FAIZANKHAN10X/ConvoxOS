'use client';

// /f/[token] — public lead-capture page. Client-rendered like
// /join/[token]: the schema loads from the peek endpoint, so no
// server render ever touches the database for anonymous visitors.
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import type { FormField } from '@/lib/forms/write';

import { PublicForm } from './public-form';

function FormLoader() {
  const params = useParams<{ token: string }>();
  const search = useSearchParams();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; name: string; fields: FormField[] }
    | { status: 'missing' }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/public/forms/${params.token}`);
        if (!res.ok) throw new Error('missing');
        const data = (await res.json()) as { name: string; fields: FormField[] };
        if (!cancelled) setState({ status: 'ready', name: data.name, fields: data.fields });
      } catch {
        if (!cancelled) setState({ status: 'missing' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.token]);

  if (state.status === 'loading') {
    return <p className="mt-4 text-sm text-muted-foreground">Loading…</p>;
  }
  if (state.status === 'missing') {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        This form is unavailable or paused.
      </p>
    );
  }
  const pick = (key: string): string | undefined => {
    const v = search.get(key);
    return v && v.trim() ? v.slice(0, 500) : undefined;
  };
  return (
    <>
      <h1 className="text-xl font-semibold">{state.name}</h1>
      <PublicForm
        token={params.token}
        fields={state.fields}
        attribution={{
          utm_source: pick('utm_source'),
          utm_medium: pick('utm_medium'),
          utm_campaign: pick('utm_campaign'),
        }}
      />
    </>
  );
}

export default function PublicFormPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <Suspense fallback={<p className="mt-4 text-sm text-muted-foreground">Loading…</p>}>
        <FormLoader />
      </Suspense>
    </main>
  );
}
