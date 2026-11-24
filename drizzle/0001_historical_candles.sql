CREATE TABLE IF NOT EXISTS `historical_candles` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `symbol` varchar(20) NOT NULL,
  `interval` varchar(4) NOT NULL,
  `openTime` bigint NOT NULL,
  `closeTime` bigint NOT NULL,
  `open` varchar(80) NOT NULL,
  `high` varchar(80) NOT NULL,
  `low` varchar(80) NOT NULL,
  `close` varchar(80) NOT NULL,
  `volume` varchar(80) NOT NULL,
  `quoteVolume` varchar(80) NOT NULL,
  `tradeCount` int unsigned NOT NULL,
  `source` varchar(40) NOT NULL,
  `fetchedAt` bigint NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `historical_candles_symbol_interval_openTime_unique` (`symbol`, `interval`, `openTime`),
  KEY `historical_candles_symbol_interval_time_idx` (`symbol`, `interval`, `openTime`)
);
