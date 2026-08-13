import api from '@actual-app/api';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, rmdirSync, statSync, rmSync } from 'fs';
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
 * Synchronizes local changes with the server and shuts down the API client.
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
 * Creates a timestamped backup of SQLite database files in the data directory and retains the five newest backups.
 *
 * @param dataDir - The directory containing the local budget database files.
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
      rmSync(oldestPath, { recursive: true, force: true });
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
 * Adds a transaction, creates a pre-write backup, and synchronizes the changes.
 *
 * @param accountId - The account receiving the transaction
 * @param categoryId - The category assigned to the transaction
 * @param amountInCents - The transaction amount in cents
 * @param payeeName - The transaction payee
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
  console.log(`Adding transaction: accountId=${accountId}, category=${categoryId}, date=${date}`);

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
