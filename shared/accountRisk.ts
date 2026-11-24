import { z } from "zod";

const decimalStringSchema = z.string().max(40).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/);
const positiveDecimalStringSchema = decimalStringSchema.refine((value) => Number(value) > 0);
export const accountRiskInputSchema = z.object({
  account: z.object({
    equity: positiveDecimalStringSchema,
    realizedDailyLoss: decimalStringSchema,
    currentOpenNotional: decimalStringSchema,
    openPositions: z.number().int().nonnegative().max(10_000),
    maxOpenPositions: z.number().int().positive().max(10_000),
    riskPerTradeBps: z.number().int().positive().max(10_000),
    maxDailyLossBps: z.number().int().positive().max(10_000),
    maxGrossExposureBps: z.number().int().positive().max(50_000),
    snapshotAt: z.number().int().nonnegative(),
  }).strict(),
  candidate: z.object({
    direction: z.enum(["LONG", "SHORT"]),
    entryPrice: positiveDecimalStringSchema,
    stopPrice: positiveDecimalStringSchema,
    contractMultiplier: positiveDecimalStringSchema,
    quantityStep: positiveDecimalStringSchema,
    minimumQuantity: positiveDecimalStringSchema,
    roundTripCostBps: z.number().int().nonnegative().max(2_000),
  }).strict(),
  evaluatedAt: z.number().int().nonnegative(),
}).strict().superRefine((input, ctx) => {
  if (input.account.maxDailyLossBps < input.account.riskPerTradeBps) {
    ctx.addIssue({ code: "custom", path: ["account", "maxDailyLossBps"], message: "Daily loss limit must cover per-trade risk" });
  }
  if (input.account.snapshotAt > input.evaluatedAt) {
    ctx.addIssue({ code: "custom", path: ["account", "snapshotAt"], message: "Account snapshot cannot be from the future" });
  }
  if (input.candidate.direction === "LONG" && Number(input.candidate.stopPrice) >= Number(input.candidate.entryPrice)) {
    ctx.addIssue({ code: "custom", path: ["candidate", "stopPrice"], message: "LONG stop must be below entry" });
  }
  if (input.candidate.direction === "SHORT" && Number(input.candidate.stopPrice) <= Number(input.candidate.entryPrice)) {
    ctx.addIssue({ code: "custom", path: ["candidate", "stopPrice"], message: "SHORT stop must be above entry" });
  }
});
export const accountRiskCheckSchema = z.object({
  key: z.enum(["account_snapshot_fresh", "position_limit", "daily_loss_limit", "trade_risk_budget", "gross_exposure_limit", "minimum_quantity"]),
  state: z.enum(["passed", "failed"]),
  reason: z.string().max(160),
}).strict();
export const accountRiskResultSchema = z.object({
  status: z.enum(["approved_for_paper_review", "rejected"]),
  checks: z.array(accountRiskCheckSchema).length(6),
  sizing: z.object({
    quantity: decimalStringSchema.nullable(),
    notional: decimalStringSchema.nullable(),
    estimatedLoss: decimalStringSchema.nullable(),
    riskBudget: decimalStringSchema,
    remainingDailyLossBudget: decimalStringSchema,
    remainingGrossExposure: decimalStringSchema,
  }).strict(),
  evaluatedAt: z.number().int().nonnegative(),
  accountSnapshotAt: z.number().int().nonnegative(),
  executionEligible: z.literal(false),
  paperReviewOnly: z.literal(true),
}).strict();
export type AccountRiskInput = z.infer<typeof accountRiskInputSchema>;
export type AccountRiskResult = z.infer<typeof accountRiskResultSchema>;
