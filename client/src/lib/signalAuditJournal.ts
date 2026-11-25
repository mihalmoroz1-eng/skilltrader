import {
  signalAuditEventSchema,
  signalAuditJournalSchema,
  type SignalAuditEvent,
} from "@shared/signalValidation";

const STORAGE_KEY = "skilltrader.signal-audit.v1";
const MAX_EVENTS = 500;

export type SignalAuditEventInput = {
  signalId: string;
  marketRunId: string;
  validationDigest: string;
  eventType: SignalAuditEvent["eventType"];
  noteCode: SignalAuditEvent["noteCode"];
};

function createEventId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function readSignalAuditJournal(): SignalAuditEvent[] {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const validation = signalAuditJournalSchema.safeParse(parsed);
    return validation.success ? validation.data : [];
  } catch {
    return [];
  }
}

/**
 * Appends a bounded device-local review event. This is convenience history,
 * not a server audit log or tamper-proof ledger.
 */
export function appendSignalAuditEvent(
  input: SignalAuditEventInput,
  occurredAt = Date.now(),
): boolean {
  try {
    const existing = readSignalAuditJournal();
    const duplicate = existing.some((event) =>
      event.signalId === input.signalId && event.eventType === input.eventType,
    );
    if (duplicate) return true;

    const event = signalAuditEventSchema.parse({
      ...input,
      eventId: createEventId(),
      occurredAt,
    });
    const next = [...existing, event].slice(-MAX_EVENTS);
    const validated = signalAuditJournalSchema.safeParse(next);
    if (!validated.success) return false;
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(validated.data));
    return true;
  } catch {
    return false;
  }
}
