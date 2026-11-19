import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoJournalRecord, downloadDemoJournalCsv } from "../client/src/lib/demoJournal";

afterEach(() => vi.unstubAllGlobals());

describe("local CSV download", () => {
  it("creates a dated file and revokes the temporary object URL", () => {
    const link = {
      href: "",
      download: "",
      style: { display: "" },
      click: vi.fn(),
      remove: vi.fn(),
    };
    const createObjectURL = vi.fn(() => "blob:skill-trader-test");
    const revokeObjectURL = vi.fn();
    const setTimeout = vi.fn((callback: () => void) => {
      callback();
      return 1;
    });

    vi.stubGlobal("document", {
      createElement: vi.fn(() => link),
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("window", { setTimeout });

    const entry = createDemoJournalRecord(
      { symbol: "XAUUSD", side: "long", entry: 2354.2, stop: 2346, target: 2370.5, size: 1 },
      "download-test",
      "2026-11-19T10:00:00.000Z",
    );

    expect(downloadDemoJournalCsv([entry], new Date("2026-11-19T00:00:00.000Z"))).toBe(true);
    expect(link.download).toBe("skill-trader-journal-2026-11-19.csv");
    expect(link.href).toBe("blob:skill-trader-test");
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:skill-trader-test");
  });
});
