import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendSignalAuditEvent, readSignalAuditJournal } from "./signalAuditJournal";

const STORAGE_KEY = "skilltrader.signal-audit.v1";
const signalId = "a".repeat(24);
const marketRunId = "market-run-1";
const validationDigest = "b".repeat(64);

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createStorage());
  let counter = 0;
  vi.stubGlobal("crypto", {
    getRandomValues: (bytes: Uint8Array) => {
      counter += 1;
      bytes.fill(counter);
      return bytes;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("device-local signal audit journal", () => {
  it("appends candidate and manual-review events", () => {
    expect(appendSignalAuditEvent({
      signalId,
      marketRunId,
      validationDigest,
      eventType: "candidate_recorded",
      noteCode: "automatic_record",
    }, 1_000)).toBe(true);

    expect(appendSignalAuditEvent({
      signalId,
      marketRunId,
      validationDigest,
      eventType: "accepted_for_further_review",
      noteCode: "manual_review_accepted",
    }, 2_000)).toBe(true);

    const events = readSignalAuditJournal();
    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe("candidate_recorded");
    expect(events[1].eventType).toBe("accepted_for_further_review");
    expect(events[0].eventId).toMatch(/^[a-f0-9]{24}$/);
  });

  it("does not duplicate the same event type for the same signal", () => {
    const input = {
      signalId,
      marketRunId,
      validationDigest,
      eventType: "candidate_recorded" as const,
      noteCode: "automatic_record" as const,
    };
    expect(appendSignalAuditEvent(input, 1_000)).toBe(true);
    expect(appendSignalAuditEvent(input, 2_000)).toBe(true);
    expect(readSignalAuditJournal()).toHaveLength(1);
  });

  it("fails closed when browser storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("storage blocked"); },
      setItem: () => { throw new Error("storage blocked"); },
    });

    expect(readSignalAuditJournal()).toEqual([]);
    expect(appendSignalAuditEvent({
      signalId,
      marketRunId,
      validationDigest,
      eventType: "candidate_recorded",
      noteCode: "automatic_record",
    })).toBe(false);
  });

  it("rejects corrupt stored event payloads", () => {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ eventType: "place_order" }]));
    expect(readSignalAuditJournal()).toEqual([]);
  });
});
