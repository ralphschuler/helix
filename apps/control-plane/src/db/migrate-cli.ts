import { createHelixDatabase } from './client.ts';
import { KyselyMigrationStore, loadMigrationFiles, migrateDatabase } from './migrations.ts';

const db = createHelixDatabase();

try {
  const result = await migrateDatabase(new KyselyMigrationStore(db), await loadMigrationFiles());
  for (const id of result.applied) process.stdout.write(`applied ${id}\n`);
  for (const id of result.skipped) process.stdout.write(`skipped ${id}\n`);
  process.stdout.write(`db:migrate complete (${result.applied.length} applied, ${result.skipped.length} skipped)\n`);
} finally {
  await db.destroy();
}
