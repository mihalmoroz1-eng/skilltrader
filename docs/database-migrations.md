# Database Migrations

## Source of truth
Database changes are committed as ordered SQL migration files under drizzle/ and registered in drizzle/meta/_journal.json. The current migrations include the initial user schema, historical candle storage, PAPER execution ledger and public Futures order-book observations.

## Applying migrations
Set DATABASE_URL in the deployment environment, then run:

- pnpm db:migrate
- or pnpm db:push (an alias for applying the committed migration journal)

Both commands apply committed migrations only. They do not generate a new migration.

## Creating a schema change
1. Update drizzle/schema.ts.
2. Add the next numbered SQL migration under drizzle/.
3. Register it in drizzle/meta/_journal.json with the next idx.
4. Review SQL types, indexes, constraints and compatibility.
5. Run TypeScript checks and CI. Apply migrations only in the intended database environment.

The repository currently does not maintain a complete Drizzle snapshot for every historical migration. Therefore db:push intentionally does not call drizzle-kit generate; auto-generation against an incomplete snapshot chain could produce duplicate DDL. Add and validate a complete snapshot chain before re-enabling automatic generation.

The historical Futures order-book archive is introduced by `0003_futures_order_book_snapshots.sql`. Apply it only through the normal migration process in the intended database environment.
