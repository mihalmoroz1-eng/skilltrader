import { z } from "zod";
import { MARKET_DATA_INTERVALS } from "./marketData";

const backtestShape = {
  symbol: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9]+$/).transform(value => value.toUpperCase()),
  interval: z.enum(MARKET_DATA_INTERVALS),
  startTime: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  endTime: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  startingCapital: z.number().finite().min(1).max(1_000_000_000),
  riskBps: z.number().int().min(1).max(1_000).default(100),
  stopLossBps: z.number().int().min(10).max(5_000).default(200),
  takeProfitBps: z.number().int().min(10).max(10_000).default(400),
  feeBps: z.number().int().min(0).max(100).default(10),
  slippageBps: z.number().int().min(0).max(100).default(5),
  fastEmaPeriod: z.number().int().min(2).max(100).default(20),
  slowEmaPeriod: z.number().int().min(3).max(300).default(50),
  strategy: z.enum(["ema_crossover", "rsi_mean_reversion", "macd_momentum"]).default("ema_crossover"),
  rsiPeriod: z.number().int().min(2).max(100).default(14),
  rsiOversoldLevel: z.number().int().min(5).max(45).default(30),
  rsiOverboughtLevel: z.number().int().min(55).max(95).default(70),
  macdFastPeriod: z.number().int().min(2).max(100).default(12),
  macdSlowPeriod: z.number().int().min(3).max(300).default(26),
  macdSignalPeriod: z.number().int().min(2).max(100).default(9),
  allowShort: z.boolean().default(false),
};

function validateBacktestParameters(
  value: {
    startTime: number;
    endTime: number;
    fastEmaPeriod: number;
    slowEmaPeriod: number;
    strategy: "ema_crossover" | "rsi_mean_reversion" | "macd_momentum";
    macdFastPeriod: number;
    macdSlowPeriod: number;
    macdSignalPeriod: number;
    rsiOversoldLevel: number;
    rsiOverboughtLevel: number;
    riskBps: number;
    stopLossBps: number;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.endTime <= value.startTime) {
    ctx.addIssue({ code: "custom", message: "endTime must be greater than startTime", path: ["endTime"] });
  }
  if (value.endTime - value.startTime > 366 * 24 * 60 * 60 * 1000) {
    ctx.addIssue({ code: "custom", message: "range cannot exceed 366 days", path: ["endTime"] });
  }
  if (value.strategy === "ema_crossover" && value.fastEmaPeriod >= value.slowEmaPeriod) {
    ctx.addIssue({ code: "custom", message: "fast EMA period must be less than slow EMA period", path: ["fastEmaPeriod"] });
  }
  if (value.strategy === "macd_momentum" && value.macdFastPeriod >= value.macdSlowPeriod) {
    ctx.addIssue({ code: "custom", message: "MACD fast period must be less than slow period", path: ["macdFastPeriod"] });
  }
  if (value.strategy === "rsi_mean_reversion" && value.rsiOverboughtLevel - value.rsiOversoldLevel < 10) {
    ctx.addIssue({ code: "custom", message: "RSI thresholds must be separated by at least 10 points", path: ["rsiOverboughtLevel"] });
  }
  if (value.riskBps >= value.stopLossBps) {
    ctx.addIssue({ code: "custom", message: "risk budget must be below stop-loss distance for 1x notional cap", path: ["riskBps"] });
  }
}

export const backtestRequestSchema = z.object(backtestShape).strict()
  .superRefine((value, ctx) => validateBacktestParameters(value, ctx));

export const walkForwardRequestSchema = z.object({
  ...backtestShape,
  trainingCandles: z.number().int().min(3).max(30_000).default(500),
  validationCandles: z.number().int().min(10).max(10_000).default(100),
  stepCandles: z.number().int().min(10).max(10_000).default(100),
  windowCount: z.number().int().min(2).max(12).default(3),
  regimeLookback: z.number().int().min(10).max(200).default(30),
  trendThresholdBps: z.number().int().min(10).max(2_000).default(100),
  rangeThresholdBps: z.number().int().min(5).max(1_000).default(50),
  highVolatilityThresholdBps: z.number().int().min(10).max(2_000).default(200),
}).strict().superRefine((value, ctx) => {
  validateBacktestParameters(value, ctx);
  const strategyWarmup = value.strategy === "ema_crossover" ? value.slowEmaPeriod + 2 :
    value.strategy === "rsi_mean_reversion" ? value.rsiPeriod + 3 : value.macdSlowPeriod + value.macdSignalPeriod + 1;
  if (value.trainingCandles < Math.max(strategyWarmup, value.regimeLookback + 1)) {
    ctx.addIssue({
      code: "custom",
      message: "trainingCandles must include the selected strategy warm-up, regime lookback and at least two completed candles",
      path: ["trainingCandles"],
    });
  }
  if (value.rangeThresholdBps >= value.trendThresholdBps) {
    ctx.addIssue({
      code: "custom",
      message: "rangeThresholdBps must be below trendThresholdBps",
      path: ["rangeThresholdBps"],
    });
  }
  if (value.stepCandles < value.validationCandles) {
    ctx.addIssue({
      code: "custom",
      message: "stepCandles must be greater than or equal to validationCandles to prevent overlapping out-of-sample windows",
      path: ["stepCandles"],
    });
  }
  const requiredCandles = value.trainingCandles +
    (value.windowCount - 1) * value.stepCandles + value.validationCandles;
  if (requiredCandles > 50_000) {
    ctx.addIssue({ code: "custom", message: "walk-forward request cannot exceed 50,000 candles", path: ["windowCount"] });
  }
});

export type BacktestRequest = z.infer<typeof backtestRequestSchema>;
export type WalkForwardRequest = z.infer<typeof walkForwardRequestSchema>;

export const robustnessRequestSchema = z.object({
  ...backtestShape,
  regimeLookback: z.number().int().min(10).max(200).default(30),
  trendThresholdBps: z.number().int().min(10).max(2_000).default(100),
  rangeThresholdBps: z.number().int().min(5).max(1_000).default(50),
  highVolatilityThresholdBps: z.number().int().min(10).max(2_000).default(200),
}).strict().superRefine((value, ctx) => {
  validateBacktestParameters(value, ctx);
  if (value.strategy !== "ema_crossover") {
    ctx.addIssue({ code: "custom", message: "Strategy robustness currently supports EMA Crossover only", path: ["strategy"] });
  }
  if (value.feeBps > 50) {
    ctx.addIssue({
      code: "custom",
      message: "feeBps must be at most 50 because robustness includes a 2x cost stress case",
      path: ["feeBps"],
    });
  }
  if (value.slippageBps > 50) {
    ctx.addIssue({
      code: "custom",
      message: "slippageBps must be at most 50 because robustness includes a 2x cost stress case",
      path: ["slippageBps"],
    });
  }
  if (value.rangeThresholdBps >= value.trendThresholdBps) {
    ctx.addIssue({
      code: "custom",
      message: "rangeThresholdBps must be below trendThresholdBps",
      path: ["rangeThresholdBps"],
    });
  }
});

export type RobustnessRequest = z.infer<typeof robustnessRequestSchema>;

/** Benchmark comparison uses the same deterministic strategy execution contract. */
export const strategyBenchmarkRequestSchema = backtestRequestSchema;
export type StrategyBenchmarkRequest = BacktestRequest;
