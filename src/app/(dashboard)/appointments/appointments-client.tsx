'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface Appointment {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  notes: string | null;
  contact: { id: string; name: string | null; phone: string } | null;
}

interface ContactOption {
  id: string;
  name: string | null;
  phone: string;
}

const TERMINAL = new Set(['cancelled', 'completed']);

export function AppointmentsClient({
  initialAppointments,
}: {
  initialAppointments: Appointment[];
}) {
  const [appointments, setAppointments] = useState(initialAppointments);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .order('name')
        .limit(200);
      if (!cancelled) setContacts((data ?? []) as ContactOption[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    const res = await fetch('/api/appointments?limit=200');
    if (res.ok) {
      const data = (await res.json()) as { appointments: Appointment[] };
      setAppointments(data.appointments);
    }
  }

  async function book() {
    if (!title.trim() || !contactId || !startsAt) return;
    setSaving(true);
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          contact_id: contactId,
          starts_at: new Date(startsAt).toISOString(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setTitle('');
      setContactId('');
      setStartsAt('');
      setCreateOpen(false);
      await refresh();
    } catch {
      // Keep the dialog open on failure for retry.
    }
    setSaving(false);
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/appointments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await refresh();
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Appointments</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          Book appointment
        </Button>
      </div>
      {appointments.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No appointments yet. Book one to get started.
        </p>
      )}
      <div className="grid gap-3">
        {appointments.map((appt) => (
          <div key={appt.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{appt.title}</p>
                <p className="text-xs text-muted-foreground">
                  {appt.contact?.name ?? appt.contact?.phone ?? 'Unknown'} ·{' '}
                  {new Date(appt.starts_at).toLocaleString()}
                  {appt.ends_at && ` – ${new Date(appt.ends_at).toLocaleString()}`}
                  {' · '}
                  <span className="capitalize">{appt.status}</span>
                </p>
              </div>
              {!TERMINAL.has(appt.status) && (
                <div className="flex gap-1.5">
                  {appt.status === 'booked' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setStatus(appt.id, 'confirmed')}
                    >
                      Confirm
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStatus(appt.id, 'completed')}
                  >
                    Complete
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStatus(appt.id, 'cancelled')}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Book appointment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              aria-label="Title"
            />
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              aria-label="Contact"
            >
              <option value="">Select contact…</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? c.phone} · {c.phone}
                </option>
              ))}
            </select>
            <Input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              aria-label="Starts at"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={book}
              disabled={saving || !title.trim() || !contactId || !startsAt}
            >
              Book
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
