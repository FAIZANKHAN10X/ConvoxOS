'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Loader2, Shield, Wrench, User, MessageCircle, Target } from 'lucide-react';
import { AgentGoals } from './agent-goals';

export function AgentConfigure() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);

  // Identity
  const [name, setName] = useState('');
  const [role, setRole] = useState<'support' | 'sales' | 'concierge'>('support');
  const [description, setDescription] = useState('');

  // Behaviour
  const [tone, setTone] = useState<'friendly' | 'professional' | 'concise'>('friendly');
  const [responseLength, setResponseLength] = useState<'short' | 'medium' | 'long'>('medium');
  const [instructions, setInstructions] = useState('');

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json();
      if (data?.configured) {
        setConfigured(true);
        const id = data.identity ?? {};
        const bh = data.behaviour ?? {};
        setName(id.name ?? '');
        if (['support', 'sales', 'concierge'].includes(id.role)) setRole(id.role);
        setDescription(id.description ?? '');
        if (['friendly', 'professional', 'concise'].includes(bh.tone)) setTone(bh.tone);
        if (['short', 'medium', 'long'].includes(bh.responseLength)) setResponseLength(bh.responseLength);
        setInstructions(bh.instructions ?? data.system_prompt ?? '');
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const handleSave = async (section: 'identity' | 'behaviour') => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (section === 'identity') {
        body.identity = { name: name.trim() || undefined, role, description: description.trim() || undefined };
      }
      if (section === 'behaviour') {
        body.behaviour = { tone, responseLength, instructions: instructions.trim() || undefined };
        // Keep system_prompt in sync for runtime compat
        body.system_prompt = instructions.trim() || null;
      }
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save');
        return;
      }
      toast.success('Saved');
      await fetchConfig();
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Configure</h2>
        <p className="mt-1 text-sm text-muted-foreground">Tell the agent who it is and how it should behave. Your knowledge lives under Knowledge — this is voice and boundaries only.</p>
      </div>

      <Tabs defaultValue="identity" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="identity">
            <User className="mr-1.5 h-4 w-4" /> Identity
          </TabsTrigger>
          <TabsTrigger value="behaviour">
            <MessageCircle className="mr-1.5 h-4 w-4" /> Behaviour
          </TabsTrigger>
          <TabsTrigger value="goals">
            <Target className="mr-1.5 h-4 w-4" /> Goals
          </TabsTrigger>
          <TabsTrigger value="advanced">
            <Wrench className="mr-1.5 h-4 w-4" /> Advanced
          </TabsTrigger>
        </TabsList>

        <TabsContent value="identity" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Identity</CardTitle>
              <CardDescription>Who is this agent? Shown in the overview and used to shape its voice.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Agent name</Label>
                <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Convox Assistant" maxLength={80} />
                <p className="text-xs text-muted-foreground">Visible only to your team. Max 80 chars.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-role">Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                  <SelectTrigger id="agent-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="support">Support — answer questions</SelectItem>
                    <SelectItem value="sales">Sales — qualify & capture leads</SelectItem>
                    <SelectItem value="concierge">Concierge — welcome & route</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-desc">Description</Label>
                <Textarea id="agent-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Helps customers on WhatsApp and Telegram with FAQs, order status and handoff when needed." maxLength={500} />
                <p className="text-xs text-muted-foreground">{description.length}/500</p>
              </div>
              <Button onClick={() => handleSave('identity')} disabled={saving} size="sm">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save identity
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="behaviour" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="h-4 w-4 text-primary" /> Behaviour
              </CardTitle>
              <CardDescription>How the agent speaks and when it hands off to a human.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Tone</Label>
                <Select value={tone} onValueChange={(v) => setTone(v as typeof tone)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friendly">Friendly — warm, concise, helpful</SelectItem>
                    <SelectItem value="professional">Professional — formal, precise</SelectItem>
                    <SelectItem value="concise">Concise — shortest useful answer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Response length</Label>
                <Select value={responseLength} onValueChange={(v) => setResponseLength(v as typeof responseLength)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short">Short — 1–2 sentences</SelectItem>
                    <SelectItem value="medium">Medium — a short paragraph</SelectItem>
                    <SelectItem value="long">Long — detailed, with bullets</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="behaviour-instructions">Instructions & boundaries</Label>
                <Textarea id="behaviour-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={5} placeholder="We are Acme Coffee — we ship in 2–3 days, no refunds after 30 days. Be friendly. Never invent prices. If unsure, hand off." maxLength={8000} />
                <p className="text-xs text-muted-foreground">{instructions.length}/8000 — business facts belong in Knowledge, not here.</p>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Handoff when unsure</p>
                  <p className="text-xs text-muted-foreground">If the answer isn&apos;t in your knowledge, the agent hands off instead of guessing.</p>
                </div>
                <Switch checked disabled />
              </div>
              <p className="text-xs text-muted-foreground">Guardrail toggles (forbidden topics, confidence threshold) will live here in Phase 3.</p>

              <Button onClick={() => handleSave('behaviour')} disabled={saving} size="sm">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save behaviour
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="goals" className="mt-4">
          <AgentGoals />
        </TabsContent>

        <TabsContent value="advanced" className="mt-4">
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-4 w-4 text-muted-foreground" /> Advanced
              </CardTitle>
              <CardDescription>Provider, model, keys and limits — technical settings for admins.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">The provider and key form is managed in the existing AI setup below. Use it to change model or rotate keys — identity and behaviour above are the product-first controls.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
