import { describe, expect, it } from "vitest";
import {
  findLatestWhatsAppCustomerMessage,
  isWhatsAppSessionExpired,
} from "./session";

const message = (
  channel: "whatsapp" | "telegram",
  created_at: string,
  sender_type: "customer" | "agent" = "customer",
) => ({ channel, created_at, sender_type });

describe("findLatestWhatsAppCustomerMessage", () => {
  it("finds the latest inbound WhatsApp message in a WhatsApp-only thread", () => {
    const latest = message("whatsapp", "2026-01-02T00:00:00Z");
    expect(
      findLatestWhatsAppCustomerMessage([
        message("whatsapp", "2026-01-01T00:00:00Z"),
        latest,
      ]),
    ).toBe(latest);
  });

  it("does not treat Telegram activity as a WhatsApp session", () => {
    expect(
      findLatestWhatsAppCustomerMessage([
        message("telegram", "2026-01-02T00:00:00Z"),
      ]),
    ).toBeUndefined();
  });

  it("uses only WhatsApp activity in mixed-channel history", () => {
    const whatsapp = message("whatsapp", "2026-01-01T00:00:00Z");
    expect(
      findLatestWhatsAppCustomerMessage([
        whatsapp,
        message("telegram", "2026-01-03T00:00:00Z"),
      ]),
    ).toBe(whatsapp);
  });

  it("ignores outbound WhatsApp messages", () => {
    expect(
      findLatestWhatsAppCustomerMessage([
        message("whatsapp", "2026-01-02T00:00:00Z", "agent"),
      ]),
    ).toBeUndefined();
  });
});

describe("isWhatsAppSessionExpired", () => {
  const now = new Date("2026-01-02T00:00:00Z");

  it("keeps a WhatsApp-only session open for a recent inbound message", () => {
    expect(
      isWhatsAppSessionExpired(
        [message("whatsapp", "2026-01-01T12:00:00Z")],
        now,
      ),
    ).toBe(false);
  });

  it("does not create a WhatsApp session from Telegram-only history", () => {
    expect(
      isWhatsAppSessionExpired(
        [message("telegram", "2026-01-01T23:00:00Z")],
        now,
      ),
    ).toBe(true);
  });

  it("does not let recent Telegram activity extend an expired WhatsApp session", () => {
    expect(
      isWhatsAppSessionExpired(
        [
          message("whatsapp", "2025-12-31T23:00:00Z"),
          message("telegram", "2026-01-01T23:00:00Z"),
        ],
        now,
      ),
    ).toBe(true);
  });

  it("uses recent WhatsApp activity even when older Telegram history follows it", () => {
    expect(
      isWhatsAppSessionExpired(
        [
          message("telegram", "2025-12-31T23:00:00Z"),
          message("whatsapp", "2026-01-01T12:00:00Z"),
        ],
        now,
      ),
    ).toBe(false);
  });
});
