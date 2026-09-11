'use client';

import { useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface EndpointOption {
  id: string;
  name: string;
  url: string;
}

export interface HookOption {
  id: string;
  url: string | null;
}

export function EndpointPickerField({
  value,
  endpoints,
  disabled,
  onChange,
  onCreate,
}: {
  value: unknown;
  endpoints: EndpointOption[];
  disabled?: boolean;
  onChange: (value: unknown) => void;
  onCreate?: (input: {
    name: string;
    url: string;
  }) => Promise<{ id: string; secret?: string } | null>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = typeof value === 'string' ? value : '';

  return (
    <div className="space-y-1.5">
      <Label>Endpoint</Label>
      <Select
        value={selected}
        onValueChange={(next) => onChange(next)}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose an endpoint" />
        </SelectTrigger>
        <SelectContent>
          {endpoints.map((endpoint) => (
            <SelectItem key={endpoint.id} value={endpoint.id}>
              {endpoint.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {onCreate && !disabled && (
        creating ? (
          <div className="space-y-2 rounded-lg border border-border/70 p-3">
            <Input
              placeholder="Name"
              value={name}
              className="border-border/70"
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              placeholder="https://n8n.example/webhook/…"
              value={url}
              className="border-border/70"
              onChange={(event) => setUrl(event.target.value)}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || !name.trim() || !url.trim()}
                onClick={() => {
                  setBusy(true);
                  void onCreate({ name: name.trim(), url: url.trim() })
                    .then((created) => {
                      if (created) {
                        onChange(created.id);
                        setSecret(created.secret ?? null);
                        setCreating(false);
                        setName('');
                        setUrl('');
                      }
                    })
                    .finally(() => setBusy(false));
                }}
              >
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="text-xs font-medium text-primary"
            onClick={() => setCreating(true)}
          >
            Add endpoint
          </button>
        )
      )}
      {secret && (
        <OnceSecret label="Signing secret (shown once)" value={secret} />
      )}
    </div>
  );
}

export function InboundHookField({
  value,
  hook,
  disabled,
  onChange,
  onCreate,
  onRotate,
}: {
  value: unknown;
  hook: HookOption | null;
  disabled?: boolean;
  onChange: (value: unknown) => void;
  onCreate?: () => Promise<{
    id: string;
    url: string;
    secret: string;
  } | null>;
  onRotate?: () => Promise<{
    id: string;
    url: string;
    secret: string;
  } | null>;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = typeof value === 'string' ? value : '';
  const url = hook?.url ?? null;

  return (
    <div className="space-y-2">
      <Label>Inbound hook</Label>
      {hook ? (
        <Select
          value={selected || hook.id}
          onValueChange={(next) => onChange(next)}
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="This automation's hook" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={hook.id}>This automation&apos;s hook</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <p className="text-xs text-muted-foreground">
          Create a hook so external systems can start this automation.
        </p>
      )}
      {url && <CopyRow label="Webhook URL" value={url} />}
      {!url && hook && (
        <p className="text-xs text-muted-foreground">
          The URL was shown when this hook was created. Rotate to issue a new
          one.
        </p>
      )}
      {secret && (
        <OnceSecret label="HMAC secret (shown once)" value={secret} />
      )}
      {!disabled && (
        <div className="flex gap-2">
          {!hook && onCreate && (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onCreate()
                  .then((created) => {
                    if (!created) return;
                    onChange(created.id);
                    setSecret(created.secret);
                  })
                  .finally(() => setBusy(false));
              }}
            >
              Create hook
            </Button>
          )}
          {hook && onRotate && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              className="border-border/70"
              onClick={() => {
                setBusy(true);
                void onRotate()
                  .then((created) => {
                    if (!created) return;
                    onChange(created.id);
                    setSecret(created.secret);
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              Rotate
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted/50 px-2 py-1 font-mono text-[11px] text-foreground">
          {value}
        </code>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          aria-label={`Copy ${label}`}
          onClick={() => void navigator.clipboard.writeText(value)}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function OnceSecret({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <CopyRow label={label} value={value} />
    </div>
  );
}
