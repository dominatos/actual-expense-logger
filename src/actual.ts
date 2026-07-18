import api from '@actual-app/api';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, rmdirSync, statSync } from 'fs';
import { join, relative } from 'path';
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
  try {
    await api.sync();
    console.log('Sync complete.');
  } finally {
    console.log('Shutting down API...');
    await api.shutdown();
    console.log('API shut down.');
  }
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

  function copyRecursive(srcDir: string, destDir: string): void {
    const entries = readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(srcDir, entry.name);
      const relPath = relative(dataDir, srcPath);

      // Skip the backup directory itself
      if (relPath.startsWith('backups')) continue;

      if (entry.isDirectory()) {
        mkdirSync(join(destDir, entry.name), { recursive: true });
        copyRecursive(srcPath, join(destDir, entry.name));
      } else if (
        entry.name.endsWith('.sqlite') ||
        entry.name.endsWith('-journal') ||
        entry.name.endsWith('-wal') ||
        entry.name.endsWith('-shm')
      ) {
        const content = readFileSync(srcPath);
        writeFileSync(join(destDir, entry.name), content);
      }
    }
  }

  copyRecursive(dataDir, snapshotDir);
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
    } catch (err) {
      console.error(`Failed to rotate backup ${oldest}:`, err);
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
 * Fetch non-closed accounts from Actual Budget.
 */
export async function getAccounts(): Promise<Array<{ id: string; name: string }>> {
  const result = await api.getAccounts();
  return result
    .filter((a) => !a.closed)
    .map((a) => ({ id: a.id, name: a.name }));
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
