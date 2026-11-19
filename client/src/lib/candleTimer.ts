export const DEMO_CANDLE_INTERVAL_MS = 15 * 60 * 1000;

export function getCandleTimeRemaining(nowMs: number, intervalMs = DEMO_CANDLE_INTERVAL_MS): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(intervalMs) || intervalMs <= 0) return 0;
  const alignedNow = Math.floor(nowMs / 1000) * 1000;
  const elapsed = ((alignedNow % intervalMs) + intervalMs) % intervalMs;
  return intervalMs - elapsed;
}

export function formatCandleCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(Number.isFinite(remainingMs) ? remainingMs / 1000 : 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
