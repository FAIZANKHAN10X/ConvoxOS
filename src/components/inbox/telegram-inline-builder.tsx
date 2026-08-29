'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, ExternalLink } from 'lucide-react';
import { TelegramInlineButton, TelegramInlineMarkup, validateTelegramInlineMarkup } from '@/lib/channels/telegram/keyboard';

function nextCallback(existing: string[]): string {
  const taken = new Set(existing);
  let n = existing.length + 1;
  while (taken.has(`cb_${n}`)) n++;
  return `cb_${n}`;
}

export function TelegramInlinePreview({ markup }: { markup: TelegramInlineMarkup | null }) {
  if (!markup || markup.inline_keyboard.length === 0) return <p className="text-xs text-muted-foreground">No buttons yet.</p>;
  return (
    <div className="space-y-1">
      {markup.inline_keyboard.map((row, ri) => (
        <div key={ri} className="flex gap-1">
          {row.map((btn, ci) => (
            <span
              key={ci}
              className={`flex-1 rounded-md border px-2 py-1 text-center text-xs ${btn.disabled ? 'opacity-50 bg-muted' : 'bg-card border-border'}`}
            >
              {btn.text || '—'} {btn.url ? <ExternalLink className="ml-1 inline size-3" /> : null}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

interface BuilderProps {
  value: TelegramInlineMarkup | null;
  onChange: (next: TelegramInlineMarkup | null) => void;
}

export function TelegramInlineBuilder({ value, onChange }: BuilderProps) {
  const markup: TelegramInlineMarkup = value ?? { inline_keyboard: [[{ text: '', callback_data: '' }]] };
  const validation = validateTelegramInlineMarkup(markup);
  const error = validation.ok ? null : (validation as { error: string }).error;

  const update = (next: TelegramInlineMarkup) => onChange(next);

  const setButton = (r: number, c: number, patch: Partial<TelegramInlineButton>) => {
    const next = structuredClone(markup) as TelegramInlineMarkup;
    Object.assign(next.inline_keyboard[r][c], patch);
    update(next);
  };

  const addRow = () => {
    const all = markup.inline_keyboard.flat().map((b) => b.callback_data ?? '').filter(Boolean);
    const next = structuredClone(markup) as TelegramInlineMarkup;
    next.inline_keyboard.push([{ text: '', callback_data: nextCallback(all) }]);
    update(next);
  };

  const addButton = (r: number) => {
    const all = markup.inline_keyboard.flat().map((b) => b.callback_data ?? '').filter(Boolean);
    const next = structuredClone(markup) as TelegramInlineMarkup;
    next.inline_keyboard[r].push({ text: '', callback_data: nextCallback(all) });
    update(next);
  };

  const removeButton = (r: number, c: number) => {
    const next = structuredClone(markup) as TelegramInlineMarkup;
    next.inline_keyboard[r].splice(c, 1);
    if (next.inline_keyboard[r].length === 0) next.inline_keyboard.splice(r, 1);
    if (next.inline_keyboard.length === 0) {
      onChange(null);
      return;
    }
    update(next);
  };

  return (
    <div className="space-y-4">
      {markup.inline_keyboard.map((row, ri) => (
        <div key={ri} className="rounded-md border border-border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Row {ri + 1}</span>
            <Button variant="ghost" size="sm" onClick={() => addButton(ri)} className="h-7 text-xs">
              <Plus className="mr-1 size-3" /> Add button
            </Button>
          </div>
          {row.map((btn, ci) => {
            const variant: 'callback' | 'url' = btn.url !== undefined ? 'url' : 'callback';
            return (
              <div key={ci} className="grid gap-2 rounded border border-dashed border-border p-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Text (1-64)</Label>
                    <Input
                      value={btn.text}
                      onChange={(e) => setButton(ri, ci, { text: e.target.value })}
                      placeholder="Yes"
                      maxLength={64}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select
                      value={variant}
                      onValueChange={(v) => {
                        if (v === 'callback') setButton(ri, ci, { callback_data: nextCallback(markup.inline_keyboard.flat().map((b) => b.callback_data ?? '')), url: undefined });
                        else setButton(ri, ci, { url: 'https://', callback_data: undefined });
                      }}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="callback">Callback</SelectItem>
                        <SelectItem value="url">URL</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {variant === 'callback' ? (
                  <div className="space-y-1">
                    <Label className="text-xs">callback_data (1-64 bytes)</Label>
                    <Input
                      value={btn.callback_data ?? ''}
                      onChange={(e) => setButton(ri, ci, { callback_data: e.target.value })}
                      placeholder="yes"
                      maxLength={64}
                    />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label className="text-xs">URL (https)</Label>
                    <Input
                      value={btn.url ?? ''}
                      onChange={(e) => setButton(ri, ci, { url: e.target.value })}
                      placeholder="https://example.com"
                    />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={!!btn.disabled}
                      onCheckedChange={(v) => setButton(ri, ci, { disabled: v })}
                    />
                    Disabled
                  </label>
                  <Button variant="ghost" size="sm" onClick={() => removeButton(ri, ci)} className="h-7 text-destructive">
                    <Trash2 className="mr-1 size-3" /> Remove
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="mr-1 size-3" /> Add row
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)} className="text-muted-foreground">
          Clear keyboard
        </Button>
      </div>
      {error ? <p className="text-xs text-red-500">{error}</p> : <p className="text-xs text-emerald-600">Valid — {markup.inline_keyboard.flat().length} buttons</p>}
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <p className="mb-2 text-xs font-medium">Preview</p>
        <TelegramInlinePreview markup={markup} />
      </div>
    </div>
  );
}
