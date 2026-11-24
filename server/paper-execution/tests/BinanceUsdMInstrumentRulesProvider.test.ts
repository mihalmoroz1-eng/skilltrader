import { describe, expect, it } from "vitest";
import { parseBinanceInstrumentRules } from "../providers/BinanceUsdMInstrumentRulesProvider";

const payload = {
  symbols: [{
    symbol: "BTCUSDT", status: "TRADING", contractType: "PERPETUAL", quoteAsset: "USDT",
    filters: [
      { filterType: "PRICE_FILTER", tickSize: "0.1" },
      { filterType: "LOT_SIZE", stepSize: "0.001", minQty: "0.001" },
      { filterType: "MARKET_LOT_SIZE", stepSize: "0.001", minQty: "0.001" },
    ],
  }],
};

describe("Binance USD-M instrument rules", () => {
  it("extracts tick size and market quantity constraints", () => {
    expect(parseBinanceInstrumentRules(payload, "BTCUSDT")).toEqual({
      symbol: "BTCUSDT", contractMultiplier: "1", tickSize: "0.1",
      quantityStep: "0.001", minimumQuantity: "0.001",
    });
  });

  it("rejects inactive or non-perpetual symbols", () => {
    const inactive = { symbols: [{ ...payload.symbols[0], status: "BREAK" }] };
    expect(() => parseBinanceInstrumentRules(inactive, "BTCUSDT")).toThrow(/active USDT-M perpetual/);
  });

  it("rejects malformed exchange filters", () => {
    const malformed = { symbols: [{ ...payload.symbols[0], filters: [{ filterType: "PRICE_FILTER", tickSize: "0" }] }] };
    expect(() => parseBinanceInstrumentRules(malformed, "BTCUSDT")).toThrow(/filters are incomplete/);
  });
});
