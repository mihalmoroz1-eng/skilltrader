export type CandleTimeframe = "15м" | "1ч" | "4ч";

export const CANDLE_INTERVALS_MS: Record<CandleTimeframe, number> = {
  "15м": 15 * 60 * 1000,
  "1ч": 60 * 60 * 1000,
  "4ч": 4 * 60 * 60 * 1000,
};

export const DEMO_CANDLE_INTERVAL_MS = CANDLE_INTERVALS_MS["15м"];

export function getCandleTimeRemaining(nowMs: number, intervalMs = DEMO_CANDLE_INTERVAL_MS): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(intervalMs) || intervalMs <= 0) return 0;
  const alignedNow = Math.floor(nowMs / 1000) * 1000;
  const elapsed = ((alignedNow % intervalMs) + intervalMs) % intervalMs;
  return intervalMs - elapsed;
}

export function formatCandleCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(Number.isFinite(remainingMs) ? remainingMs / 1000 : 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
