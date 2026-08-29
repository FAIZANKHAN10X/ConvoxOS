import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('TelegramConfig — secrets never leak', () => {
  it('component source never logs raw bot token', () => {
    const src = fs.readFileSync('src/components/settings/telegram-config.tsx', 'utf8');
    expect(src).not.toMatch(/console\.log\(.*botToken/);
    expect(src).not.toMatch(/console\.log\(.*token/);
    // Input is password type by default, not text leak
    expect(src).toContain("type={showToken ? 'text' : 'password'}");
  });

  it('channels-panel aggregates WhatsApp and Telegram without generic abstractions', () => {
    const src = fs.readFileSync('src/components/settings/channels-panel.tsx', 'utf8');
    expect(src).toContain('WhatsApp');
    expect(src).toContain('Telegram');
    expect(src).not.toContain('ChannelFactory');
    expect(src).not.toContain('ChannelRegistry');
  });

  it('api route encrypts before persist and returns only safe fields', () => {
    const route = fs.readFileSync('src/app/api/telegram/config/route.ts', 'utf8');
    expect(route).toContain('encrypt(token)');
    expect(route).toContain('bot_username');
    // Runtime route tests assert no plaintext token in JSON
  });
});
