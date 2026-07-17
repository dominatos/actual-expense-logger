import api from '@actual-app/api';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { loadConfig } from './config';

/**
 * Initialize Actual Budget API connection and download the budget.
 * Must be called once at startup before any operations.
 */
export async function initActual(): Promise<void> {
  const config = loadConfig();

  console.log('Initializing Actual Budget connection...');
  await api.init({
    dataDir: config.actualDataDir,
    serverURL: config.actualServerUrl,
    password: config.actualPassword,
  });

  console.log('Downloading budget...');
  const downloadOpts: { password?: string } = {};
  if (config.actualFilePassword) {
    downloadOpts.password = config.actualFilePassword;
  }
  await api.downloadBudget(config.actualSyncId, downloadOpts);
  console.log('Budget downloaded successfully.');
}

/**
 * Sync local changes to the server and shut down the API client.
 * Must always be called before exiting the process to avoid data loss.
 */
export async function finalize(): Promise<void> {
  console.log('Syncing changes to server...');
  await api.sync();
  console.log('Sync complete. Shutting down API...');
  await api.shutdown();
  console.log('API shut down.');
}

/**
 * Create a backup of the local budget database before writing.
 * Copies SQLite files from the data directory to a timestamped backup folder.
 * Keeps only the last 5 backups to avoid disk bloat.
 */
function createBackup(dataDir: string): void {
  const backupDir = join(dataDir, 'backups');
  mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotDir = join(backupDir, `backup-${timestamp}`);
  mkdirSync(snapshotDir, { recursive: true });

  const files = readdirSync(dataDir);
  for (const file of files) {
    if (file.endsWith('.sqlite') || file.endsWith('-journal') || file.endsWith('-wal') || file.endsWith('-shm')) {
      try {
        const content = readFileSync(join(dataDir, file));
        writeFileSync(join(snapshotDir, file), content);
      } catch {
        // File may be locked or transient — skip silently
      }
    }
  }

  console.log(`Backup created at ${snapshotDir}`);

  // Rotate: keep only last 5 backups
  const backups = readdirSync(backupDir)
    .filter((d) => d.startsWith('backup-'))
    .sort();

  while (backups.length > 5) {
    const oldest = backups.shift()!;
    const oldestPath = join(backupDir, oldest);
    try {
      const contents = readdirSync(oldestPath);
      for (const f of contents) {
        unlinkSync(join(oldestPath, f));
      }
      rmdirSync(oldestPath);
      console.log(`Rotated old backup: ${oldest}`);
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * Fetch categories from Actual Budget, filtering out income and hidden ones.
 */
export async function getCategories(): Promise<Array<{ id: string; name: string; is_income: boolean; hidden: boolean; group_id: string }>> {
  const result = await api.getCategories({ hidden: false });
  return result.filter(
    (c): c is { id: string; name: string; is_income: boolean; hidden: boolean; group_id: string } =>
      'group_id' in c && !c.is_income && !c.hidden
  );
}

/**
 * Add a transaction with pre-write backup and post-write sync.
 * Safety lifecycle: backup -> addTransaction -> sync
 */
export async function addTransaction(
  accountId: string,
  categoryId: string,
  amountInCents: number,
  payeeName: string
): Promise<void> {
  const config = loadConfig();
  const date = new Date().toISOString().split('T')[0];

  // Step 1: Backup before write
  console.log('Creating pre-transaction backup...');
  createBackup(config.actualDataDir);

  // Step 2: Add transaction
  console.log('Adding transaction...');
  await api.addTransactions(accountId, [
    {
      date,
      amount: amountInCents,
      category: categoryId,
      payee_name: payeeName,
    },
  ]);

  // Step 3: Sync to server immediately
  console.log('Syncing to server...');
  await api.sync();
  console.log('Transaction saved and synced.');
}
