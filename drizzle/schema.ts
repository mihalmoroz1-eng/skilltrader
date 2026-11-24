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
