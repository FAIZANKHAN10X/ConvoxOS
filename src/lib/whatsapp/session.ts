import type { Message } from "@/types";

/**
 * WhatsApp's customer-session window is based only on inbound WhatsApp
 * messages. Messages from another channel must never extend or close it.
 */
export function findLatestWhatsAppCustomerMessage(
  messages: Pick<Message, "sender_type" | "channel" | "created_at">[],
): Pick<Message, "sender_type" | "channel" | "created_at"> | undefined {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.sender_type === "customer" && message.channel === "whatsapp",
    );
}

export function isWhatsAppSessionExpired(
  messages: Pick<Message, "sender_type" | "channel" | "created_at">[],
  now = new Date(),
): boolean {
  const latest = findLatestWhatsAppCustomerMessage(messages);
  if (!latest) return true;

  return now.getTime() - new Date(latest.created_at).getTime() >= 24 * 60 * 60 * 1000;
}
