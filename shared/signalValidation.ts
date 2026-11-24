import { z } from "zod";
import { MARKET_EVIDENCE_CODES, RISK_EVIDENCE_CODES } from "./marketIntelligence";

export const SIGNAL_VALIDATION_STATUSES = [
  "reviewable",
  "rejected",
  "inconclusive",
  "no_candidate",
] as const;

export const SIGNAL_DIRECTIONS = ["LONG", "SHORT"] as const;

export const SIGNAL_VALIDATION_CHECK_KEYS = [
  "market_data_integrity",
  "agent_consensus",
  "directional_evidence",
  "strategy_alignment",
  "technical_risk_gate",
  "account_risk_engine",
] as const;

export const SIGNAL_VALIDATION_CHECK_STATES = ["passed", "failed", "inconclusive", "not_connected"] as const;

export const SIGNAL_VALIDATION_REASON_CODES = [
  "approved_source_and_fresh_data",
  "market_data_stale",
  "market_data_quality_failed",
  "market_data_provenance_invalid",
  "critic_consensus_confirmed",
  "critic_consensus_missing",
  "agent_evidence_not_server_verified",
  "uptrend_evidence_aligned",
  "downtrend_evidence_aligned",
  "directional_evidence_incomplete",
  "strategy_context_not_trend_aligned",
  "technical_risk_clear",
  "technical_risk_blocked",
  "technical_risk_agent_disagreement",
  "no_supported_directional_candidate",
  "account_risk_engine_not_integrated",
  "execution_disabled",
] as const;

export const signalValidationCheckSchema = z.object({
  key: z.enum(SIGNAL_VALIDATION_CHECK_KEYS),
  state: z.enum(SIGNAL_VALIDATION_CHECK_STATES),
  reasonCode: z.enum(SIGNAL_VALIDATION_REASON_CODES),
}).strict();

export const signalCandidateSchema = z.object({
  signalId: z.string().regex(/^[a-f0-9]{24}$/),
  direction: z.enum(SIGNAL_DIRECTIONS),
  symbol: z.string().regex(/^[A-Z0-9]{2,20}$/),
  interval: z.string().min(1).max(8),
  thesisCodes: z.array(z.enum(MARKET_EVIDENCE_CODES)).min(3).max(8),
  marketRunId: z.string().min(1).max(128),
  createdAt: z.number().int().nonnegative(),
}).strict();

export const signalValidationResultSchema = z.object({
  status: z.enum(SIGNAL_VALIDATION_STATUSES),
  candidate: signalCandidateSchema.nullable(),
  checks: z.array(signalValidationCheckSchema).length(SIGNAL_VALIDATION_CHECK_KEYS.length),
  rejectedReasonCodes: z.array(z.enum(SIGNAL_VALIDATION_REASON_CODES)).max(SIGNAL_VALIDATION_REASON_CODES.length),
  warnings: z.array(z.string().max(400)).max(12),
  provenance: z.object({
    marketRunId: z.string().min(1).max(128),
    marketEvidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    validationDigest: z.string().regex(/^[a-f0-9]{64}$/),
    validatedAt: z.number().int().nonnegative(),
  }).strict(),
  executionEligible: z.literal(false),
  requiresSeparateAccountRiskEngine: z.literal(true),
  manualReviewOnly: z.literal(true),
}).strict();

export type SignalValidationCheck = z.infer<typeof signalValidationCheckSchema>;
export type SignalCandidate = z.infer<typeof signalCandidateSchema>;
export type SignalValidationResult = z.infer<typeof signalValidationResultSchema>;

/** Append-only local audit event; it records review decisions, never trade actions. */
export const signalAuditEventSchema = z.object({
  eventId: z.string().regex(/^[a-f0-9]{24}$/),
  signalId: z.string().regex(/^[a-f0-9]{24}$/),
  marketRunId: z.string().min(1).max(128),
  validationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  eventType: z.enum(["candidate_recorded", "accepted_for_further_review", "dismissed"]),
  occurredAt: z.number().int().nonnegative(),
  noteCode: z.enum(["automatic_record", "manual_review_accepted", "manual_review_dismissed"]),
}).strict();

export const signalAuditJournalSchema = z.array(signalAuditEventSchema).max(500);

export type SignalAuditEvent = z.infer<typeof signalAuditEventSchema>;
