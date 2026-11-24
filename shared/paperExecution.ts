import { z } from "zod";

const decimal = z.string().max(40).regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/);
const positiveDecimal = decimal.refine(value => Number(value) > 0);

export const paperAccountInitializeSchema = z.object({
  startingBalance: positiveDecimal,
  riskPerTradeBps: z.number().int().min(1).max(1000),
  maxDailyLossBps: z.number().int().min(1).max(5000),
  maxGrossExposureBps: z.number().int().min(100).max(10000),
  maxOpenPositions: z.number().int().min(1).max(20),
  feeBps: z.number().int().min(0).max(100).default(5),
  slippageBps: z.number().int().min(0).max(100).default(5),
}).strict().superRefine((value, ctx) => {
  if (value.maxDailyLossBps < value.riskPerTradeBps) {
    ctx.addIssue({ code: "custom", path: ["maxDailyLossBps"], message: "Daily loss budget must cover per-trade risk" });
  }
});

export const paperSignalActionSchema = z.object({
  signalId: z.string().regex(/^[a-f0-9]{24}$/),
}).strict();

export const paperOpenPositionSchema = z.object({
  signalId: z.string().regex(/^[a-f0-9]{24}$/),
  stopPrice: positiveDecimal,
  targetPrice: positiveDecimal,
}).strict();

export const paperClosePositionSchema = z.object({
  positionId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

export type PaperAccountInitializeInput = z.infer<typeof paperAccountInitializeSchema>;
export type PaperSignalActionInput = z.infer<typeof paperSignalActionSchema>;
export type PaperOpenPositionInput = z.infer<typeof paperOpenPositionSchema>;
export type PaperClosePositionInput = z.infer<typeof paperClosePositionSchema>;
