import { describe, expect, it } from "vitest";
import { formatDemoPositionSize, getDemoPositionSpec } from "../client/src/lib/demoInstruments";
import { isValidDemoScenarioDraft } from "../client/src/lib/demoScenarioDraft";

const validEuroDraft = {
  symbol: "EURUSD",
  side: "long",
  entry: 1.0842,
  stop: 1.0804,
  target: 1.0918,
  size: 1_000,
  timeframe: "15м",
};

describe("demo instrument sizing", () => {
  it("provides explicitly illustrative units and useful starting quantities", () => {
    expect(getDemoPositionSpec("XAUUSD")).toMatchObject({ unit: "oz", defaultSize: 1 });
    expect(getDemoPositionSpec("EURUSD")).toMatchObject({ unit: "EUR", defaultSize: 1_000 });
    expect(getDemoPositionSpec("BTCUSD")).toMatchObject({ unit: "BTC", defaultSize: 0.01 });
  });

  it("formats each position volume with its unit", () => {
    expect(formatDemoPositionSize("XAUUSD", 1)).toBe("1 oz");
    expect(formatDemoPositionSize("EURUSD", 1_000)).toMatch(/1\s?000 EUR/);
    expect(formatDemoPositionSize("BTCUSD", 0.01)).toBe("0,01 BTC");
    expect(formatDemoPositionSize("unknown", 2)).toBe("2 ед.");
  });

  it("validates the position size against the selected instrument's demo minimum", () => {
    expect(isValidDemoScenarioDraft(validEuroDraft)).toBe(true);
    expect(isValidDemoScenarioDraft({ ...validEuroDraft, size: 0.01 })).toBe(false);
    expect(isValidDemoScenarioDraft({ ...validEuroDraft, symbol: "BTCUSD", size: 0.001 })).toBe(true);
  });
});
