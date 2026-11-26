CREATE TABLE IF NOT EXISTS `futures_order_book_snapshots` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `symbol` varchar(20) NOT NULL,
  `source` varchar(40) NOT NULL,
  `observedAt` bigint NOT NULL,
  `fetchedAt` bigint NOT NULL,
  `lastUpdateId` bigint unsigned NOT NULL,
  `bestBid` varchar(80) NOT NULL,
  `bestAsk` varchar(80) NOT NULL,
  `bidsJson` text NOT NULL,
  `asksJson` text NOT NULL,
  `bidLevels` int unsigned NOT NULL,
  `askLevels` int unsigned NOT NULL,
  `contentDigest` varchar(64) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `futures_order_book_symbol_observed_update_unique` (`symbol`, `observedAt`, `lastUpdateId`),
  KEY `futures_order_book_symbol_observed_idx` (`symbol`, `observedAt`)
);
