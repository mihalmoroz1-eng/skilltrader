import { bigint, int, mysqlEnum, mysqlTable, text, timestamp, varchar, uniqueIndex, index } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** Decimal exchange values are strings; no floating-point conversion is performed. */
export const historicalCandles = mysqlTable("historical_candles", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  interval: varchar("interval", { length: 4 }).notNull(),
  openTime: bigint("openTime", { mode: "number" }).notNull(),
  closeTime: bigint("closeTime", { mode: "number" }).notNull(),
  open: varchar("open", { length: 80 }).notNull(),
  high: varchar("high", { length: 80 }).notNull(),
  low: varchar("low", { length: 80 }).notNull(),
  close: varchar("close", { length: 80 }).notNull(),
  volume: varchar("volume", { length: 80 }).notNull(),
  quoteVolume: varchar("quoteVolume", { length: 80 }).notNull(),
  tradeCount: int("tradeCount", { unsigned: true }).notNull(),
  source: varchar("source", { length: 40 }).notNull(),
  fetchedAt: bigint("fetchedAt", { mode: "number" }).notNull(),
}, table => ({
  candleUnique: uniqueIndex("historical_candles_symbol_interval_openTime_unique")
    .on(table.symbol, table.interval, table.openTime),
  rangeIndex: index("historical_candles_symbol_interval_time_idx")
    .on(table.symbol, table.interval, table.openTime),
}));


/** Virtual-only trading ledger. These tables never map to exchange order endpoints. */
export const paperAccounts = mysqlTable("paper_accounts", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  userOpenId: varchar("userOpenId", { length: 64 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("USDT").notNull(),
  startingBalance: varchar("startingBalance", { length: 40 }).notNull(),
  cashBalance: varchar("cashBalance", { length: 40 }).notNull(),
  realizedDailyLoss: varchar("realizedDailyLoss", { length: 40 }).default("0").notNull(),
  dailyLossDate: varchar("dailyLossDate", { length: 10 }).notNull(),
  riskPerTradeBps: int("riskPerTradeBps", { unsigned: true }).notNull(),
  maxDailyLossBps: int("maxDailyLossBps", { unsigned: true }).notNull(),
  maxGrossExposureBps: int("maxGrossExposureBps", { unsigned: true }).notNull(),
  maxOpenPositions: int("maxOpenPositions", { unsigned: true }).notNull(),
  feeBps: int("feeBps", { unsigned: true }).notNull(),
  slippageBps: int("slippageBps", { unsigned: true }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userUnique: uniqueIndex("paper_accounts_userOpenId_unique").on(table.userOpenId),
}));

export const paperSignalReviews = mysqlTable("paper_signal_reviews", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  userOpenId: varchar("userOpenId", { length: 64 }).notNull(),
  signalId: varchar("signalId", { length: 24 }).notNull(),
  marketRunId: varchar("marketRunId", { length: 128 }).notNull(),
  validationDigest: varchar("validationDigest", { length: 64 }).notNull(),
  marketEvidenceDigest: varchar("marketEvidenceDigest", { length: 64 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  interval: varchar("interval", { length: 4 }).notNull(),
  direction: mysqlEnum("direction", ["LONG", "SHORT"]).notNull(),
  thesisCodes: text("thesisCodes").notNull(),
  status: mysqlEnum("status", ["pending", "accepted", "dismissed", "consumed"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userSignalUnique: uniqueIndex("paper_signal_reviews_user_signal_unique").on(table.userOpenId, table.signalId),
  userStatusIndex: index("paper_signal_reviews_user_status_idx").on(table.userOpenId, table.status),
}));

export const paperPositions = mysqlTable("paper_positions", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  userOpenId: varchar("userOpenId", { length: 64 }).notNull(),
  signalId: varchar("signalId", { length: 24 }).notNull(),
  marketRunId: varchar("marketRunId", { length: 128 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  interval: varchar("interval", { length: 4 }).notNull(),
  side: mysqlEnum("side", ["LONG", "SHORT"]).notNull(),
  quantity: varchar("quantity", { length: 40 }).notNull(),
  notional: varchar("notional", { length: 40 }).notNull(),
  entryPrice: varchar("entryPrice", { length: 40 }).notNull(),
  stopPrice: varchar("stopPrice", { length: 40 }).notNull(),
  targetPrice: varchar("targetPrice", { length: 40 }),
  contractMultiplier: varchar("contractMultiplier", { length: 40 }).notNull(),
  tickSize: varchar("tickSize", { length: 40 }).notNull(),
  entryFee: varchar("entryFee", { length: 40 }).notNull(),
  status: mysqlEnum("status", ["open", "closed"]).default("open").notNull(),
  openedAt: bigint("openedAt", { mode: "number" }).notNull(),
  closedAt: bigint("closedAt", { mode: "number" }),
  exitPrice: varchar("exitPrice", { length: 40 }),
  grossPnl: varchar("grossPnl", { length: 40 }),
  netPnl: varchar("netPnl", { length: 40 }),
  feesPaid: varchar("feesPaid", { length: 40 }).default("0").notNull(),
  exitReason: mysqlEnum("exitReason", ["manual", "stop_loss", "take_profit", "end_of_data"]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userSignalUnique: uniqueIndex("paper_positions_user_signal_unique").on(table.userOpenId, table.signalId),
  userStatusIndex: index("paper_positions_user_status_idx").on(table.userOpenId, table.status),
  userSymbolIndex: index("paper_positions_user_symbol_idx").on(table.userOpenId, table.symbol),
}));

export const paperEvents = mysqlTable("paper_events", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  userOpenId: varchar("userOpenId", { length: 64 }).notNull(),
  eventType: mysqlEnum("eventType", ["account_initialized", "signal_recorded", "signal_accepted", "signal_dismissed", "position_opened", "position_closed"]).notNull(),
  entityId: varchar("entityId", { length: 64 }),
  eventPayload: text("eventPayload").notNull(),
  occurredAt: bigint("occurredAt", { mode: "number" }).notNull(),
}, table => ({
  userTimeIndex: index("paper_events_user_time_idx").on(table.userOpenId, table.occurredAt),
}));


/** Immutable public Futures order-book observations; observedAt is the conservative local receipt time. */
export const futuresOrderBookSnapshots = mysqlTable("futures_order_book_snapshots", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  source: varchar("source", { length: 40 }).notNull(),
  observedAt: bigint("observedAt", { mode: "number" }).notNull(),
  fetchedAt: bigint("fetchedAt", { mode: "number" }).notNull(),
  lastUpdateId: bigint("lastUpdateId", { mode: "number", unsigned: true }).notNull(),
  bestBid: varchar("bestBid", { length: 80 }).notNull(),
  bestAsk: varchar("bestAsk", { length: 80 }).notNull(),
  bidsJson: text("bidsJson").notNull(),
  asksJson: text("asksJson").notNull(),
  bidLevels: int("bidLevels", { unsigned: true }).notNull(),
  askLevels: int("askLevels", { unsigned: true }).notNull(),
  contentDigest: varchar("contentDigest", { length: 64 }).notNull(),
}, table => ({
  observationUnique: uniqueIndex("futures_order_book_symbol_observed_update_unique")
    .on(table.symbol, table.observedAt, table.lastUpdateId),
  timeIndex: index("futures_order_book_symbol_observed_idx").on(table.symbol, table.observedAt),
}));
