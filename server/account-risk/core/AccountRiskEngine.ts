import {
  accountRiskInputSchema,
  accountRiskResultSchema,
  type AccountRiskInput,
  type AccountRiskResult,
} from "@shared/accountRisk";

const SCALE = 100_000_000n;
const MAX_ACCOUNT_SNAPSHOT_AGE_MS = 30_000n;
function parseDecimal(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0"));
}
function formatDecimal(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
function multiplyBps(value: bigint, bps: number): bigint {
  return (value * BigInt(bps)) / 10_000n;
}
function floorToStep(value: bigint, step: bigint): bigint {
  return (value / step) * step;
}
function divideFloor(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Risk calculation denominator must be positive");
  return numerator / denominator;
}
function check(key: AccountRiskResult["checks"][number]["key"], passed: boolean, successReason: string, failureReason: string): AccountRiskResult["checks"][number] {
  return { key, state: passed ? "passed" : "failed", reason: passed ? successReason : failureReason };
}

/** Deterministic fixed-point risk sizing for PAPER review only. Never creates or sends orders. */
export function evaluateAccountRisk(rawInput: AccountRiskInput): AccountRiskResult {
  const input = accountRiskInputSchema.parse(rawInput);
  const { account, candidate } = input;
  const equity = parseDecimal(account.equity);
  const realizedDailyLoss = parseDecimal(account.realizedDailyLoss);
  const currentOpenNotional = parseDecimal(account.currentOpenNotional);
  const entry = parseDecimal(candidate.entryPrice);
  const stop = parseDecimal(candidate.stopPrice);
  const multiplier = parseDecimal(candidate.contractMultiplier);
  const step = parseDecimal(candidate.quantityStep);
  const minimumQuantity = parseDecimal(candidate.minimumQuantity);

  const riskBudget = multiplyBps(equity, account.riskPerTradeBps);
  const dailyLossLimit = multiplyBps(equity, account.maxDailyLossBps);
  const remainingDailyLossBudget = dailyLossLimit > realizedDailyLoss ? dailyLossLimit - realizedDailyLoss : 0n;
  const grossExposureLimit = multiplyBps(equity, account.maxGrossExposureBps);
  const remainingGrossExposure = grossExposureLimit > currentOpenNotional ? grossExposureLimit - currentOpenNotional : 0n;
  const stopDistance = entry > stop ? entry - stop : stop - entry;
  const unitPriceExposure = (entry * multiplier) / SCALE;
  const unitStopLoss = (stopDistance * multiplier) / SCALE;
  const unitTradingCosts = multiplyBps(unitPriceExposure, candidate.roundTripCostBps);
  const riskPerUnit = unitStopLoss + unitTradingCosts;

  const calculationPossible = unitPriceExposure > 0n && riskPerUnit > 0n;
  const maxQuantityByRisk = riskPerUnit > 0n ? divideFloor(riskBudget * SCALE, riskPerUnit) : 0n;
  const maxQuantityByExposure = unitPriceExposure > 0n
    ? divideFloor(remainingGrossExposure * SCALE, unitPriceExposure)
    : 0n;
  const quantity = floorToStep(maxQuantityByRisk < maxQuantityByExposure ? maxQuantityByRisk : maxQuantityByExposure, step);
  const notional = (quantity * unitPriceExposure) / SCALE;
  const estimatedLoss = (quantity * riskPerUnit) / SCALE;

  const snapshotFresh = BigInt(input.evaluatedAt) >= BigInt(account.snapshotAt) && BigInt(input.evaluatedAt) - BigInt(account.snapshotAt) <= MAX_ACCOUNT_SNAPSHOT_AGE_MS;
  const positionLimitPassed = account.openPositions < account.maxOpenPositions;
  const dailyLossPassed = remainingDailyLossBudget > 0n && estimatedLoss <= remainingDailyLossBudget;
  const tradeRiskPassed = calculationPossible && estimatedLoss > 0n && estimatedLoss <= riskBudget;
  const exposurePassed = unitPriceExposure > 0n && remainingGrossExposure > 0n && notional <= remainingGrossExposure;
  const minimumQuantityPassed = quantity >= minimumQuantity;
  const checks = [
    check("account_snapshot_fresh", snapshotFresh, "Account snapshot is current", "Account snapshot is stale"),
    check("position_limit", positionLimitPassed, "Open-position limit is available", "Maximum open-position count reached"),
    check("daily_loss_limit", dailyLossPassed, "Daily loss budget remains available", "Daily loss budget is exhausted or insufficient"),
    check("trade_risk_budget", tradeRiskPassed, "Estimated loss is within the per-trade risk budget", "Estimated loss exceeds the per-trade risk budget"),
    check("gross_exposure_limit", exposurePassed, "Gross exposure remains within the configured limit", "Gross exposure limit is exhausted or insufficient"),
    check("minimum_quantity", minimumQuantityPassed, "Calculated quantity meets the instrument minimum", "Calculated quantity is below the instrument minimum"),
  ];
  const approved = checks.every((item) => item.state === "passed");
  return accountRiskResultSchema.parse({
    status: approved ? "approved_for_paper_review" : "rejected",
    checks,
    sizing: {
      quantity: approved ? formatDecimal(quantity) : null,
      notional: approved ? formatDecimal(notional) : null,
      estimatedLoss: approved ? formatDecimal(estimatedLoss) : null,
      riskBudget: formatDecimal(riskBudget),
      remainingDailyLossBudget: formatDecimal(remainingDailyLossBudget),
      remainingGrossExposure: formatDecimal(remainingGrossExposure),
    },
    evaluatedAt: input.evaluatedAt,
    accountSnapshotAt: account.snapshotAt,
    executionEligible: false,
    paperReviewOnly: true,
  });
}
