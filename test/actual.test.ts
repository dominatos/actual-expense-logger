import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';

// Use vi.hoisted() so mock references are available in the hoisted vi.mock factory
const mocks = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue(undefined),
  downloadBudget: vi.fn().mockResolvedValue(undefined),
  sync: vi.fn().mockResolvedValue(undefined),
  shutdown: vi.fn().mockResolvedValue(undefined),
  addTransactions: vi.fn().mockResolvedValue('ok'),
  getCategories: vi.fn().mockResolvedValue([]),
  getAccounts: vi.fn().mockResolvedValue([]),
  loadConfig: vi.fn().mockReturnValue({
    telegramBotToken: 'test-token',
    actualServerUrl: 'http://localhost:5006',
    actualPassword: 'test-password',
    actualSyncId: 'test-sync-id',
    accounts: [{ name: 'Default', id: 'test-account-id' }],
    actualDataDir: '/tmp/test-actual-data',
    actualFilePassword: undefined,
    actualPayeeName: 'Telegram Bot',
    allowedUserIds: [],
  }),
}));

vi.mock('@actual-app/api', () => ({
  default: {
    init: mocks.init,
    downloadBudget: mocks.downloadBudget,
    sync: mocks.sync,
    shutdown: mocks.shutdown,
    addTransactions: mocks.addTransactions,
    getCategories: mocks.getCategories,
    getAccounts: mocks.getAccounts,
  },
}));

vi.mock('../src/config', () => ({
  loadConfig: mocks.loadConfig,
}));

// Import after mocks are set up
import { initActual, finalize, getCategories, getAccounts, addTransaction } from '../src/actual';

describe('initActual', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls api.init with correct config', async () => {
    await initActual();
    expect(mocks.init).toHaveBeenCalledWith({
      dataDir: '/tmp/test-actual-data',
      serverURL: 'http://localhost:5006',
      password: 'test-password',
    });
  });

  it('calls api.downloadBudget with syncId', async () => {
    await initActual();
    expect(mocks.downloadBudget).toHaveBeenCalledWith('test-sync-id', {});
  });
});

describe('finalize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls api.sync() then api.shutdown()', async () => {
    await finalize();
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.shutdown).toHaveBeenCalledOnce();
    expect(mocks.sync).toHaveBeenCalledBefore(mocks.shutdown);
  });
});

describe('getCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters out income categories', async () => {
    mocks.getCategories.mockResolvedValue([
      { id: '1', name: 'Food', is_income: false, hidden: false, group_id: 'g1' },
      { id: '2', name: 'Salary', is_income: true, hidden: false, group_id: 'g2' },
      { id: '3', name: 'Transport', is_income: false, hidden: false, group_id: 'g1' },
    ]);

    const result = await getCategories();
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.name)).toEqual(['Food', 'Transport']);
  });

  it('filters out hidden categories', async () => {
    mocks.getCategories.mockResolvedValue([
      { id: '1', name: 'Food', is_income: false, hidden: false, group_id: 'g1' },
      { id: '2', name: 'Hidden Cat', is_income: false, hidden: true, group_id: 'g1' },
    ]);

    const result = await getCategories();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Food');
  });

  it('filters out category groups (no group_id)', async () => {
    mocks.getCategories.mockResolvedValue([
      { id: 'g1', name: 'Essentials', is_income: false, hidden: false },
      { id: '1', name: 'Food', is_income: false, hidden: false, group_id: 'g1' },
    ]);

    const result = await getCategories();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('returns empty array when no categories', async () => {
    mocks.getCategories.mockResolvedValue([]);
    const result = await getCategories();
    expect(result).toEqual([]);
  });
});

describe('getAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters out closed accounts', async () => {
    mocks.getAccounts.mockResolvedValue([
      { id: '1', name: 'Checking', closed: false },
      { id: '2', name: 'Old Account', closed: true },
      { id: '3', name: 'Savings', closed: false },
    ]);

    const result = await getAccounts();
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(['Checking', 'Savings']);
  });

  it('returns id and name only', async () => {
    mocks.getAccounts.mockResolvedValue([
      { id: '1', name: 'Checking', offbudget: false, closed: false, balance_current: 5000 },
    ]);

    const result = await getAccounts();
    expect(result).toEqual([{ id: '1', name: 'Checking' }]);
  });

  it('returns empty array when no accounts', async () => {
    mocks.getAccounts.mockResolvedValue([]);
    const result = await getAccounts();
    expect(result).toEqual([]);
  });
});

describe('addTransaction', () => {
  const testDir = '/tmp/test-backup-actual';

  beforeEach(() => {
    vi.clearAllMocks();
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'test.sqlite'), 'fake-sqlite-data');
    writeFileSync(join(testDir, 'test.sqlite-wal'), 'fake-wal-data');
    writeFileSync(join(testDir, 'other-file.txt'), 'should-not-be-copied');
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('creates backup before adding transaction', async () => {
    mocks.loadConfig.mockReturnValue({
      telegramBotToken: 'test-token',
      actualServerUrl: 'http://localhost:5006',
      actualPassword: 'test-password',
      actualSyncId: 'test-sync-id',
      accounts: [{ name: 'Default', id: 'test-account-id' }],
      actualDataDir: testDir,
      actualFilePassword: undefined,
      actualPayeeName: 'Telegram Bot',
      allowedUserIds: [],
    });

    await addTransaction('account-1', 'cat-1', -1500, 'Telegram Bot');

    const backupDir = join(testDir, 'backups');
    expect(existsSync(backupDir)).toBe(true);

    const backups = readdirSync(backupDir).filter((d) => d.startsWith('backup-'));
    expect(backups.length).toBe(1);

    const backupFiles = readdirSync(join(backupDir, backups[0]));
    expect(backupFiles).toContain('test.sqlite');
    expect(backupFiles).toContain('test.sqlite-wal');
    expect(backupFiles).not.toContain('other-file.txt');
  });

  it('calls addTransactions with correct params', async () => {
    mocks.loadConfig.mockReturnValue({
      telegramBotToken: 'test-token',
      actualServerUrl: 'http://localhost:5006',
      actualPassword: 'test-password',
      actualSyncId: 'test-sync-id',
      accounts: [{ name: 'Default', id: 'test-account-id' }],
      actualDataDir: testDir,
      actualFilePassword: undefined,
      actualPayeeName: 'Test Payee',
      allowedUserIds: [],
    });

    await addTransaction('account-1', 'cat-1', -1500, 'Test Payee');

    expect(mocks.addTransactions).toHaveBeenCalledWith('account-1', [
      {
        date: new Date().toISOString().split('T')[0],
        amount: -1500,
        category: 'cat-1',
        payee_name: 'Test Payee',
      },
    ]);
  });

  it('calls sync() after adding transaction', async () => {
    mocks.loadConfig.mockReturnValue({
      telegramBotToken: 'test-token',
      actualServerUrl: 'http://localhost:5006',
      actualPassword: 'test-password',
      actualSyncId: 'test-sync-id',
      accounts: [{ name: 'Default', id: 'test-account-id' }],
      actualDataDir: testDir,
      actualFilePassword: undefined,
      actualPayeeName: 'Telegram Bot',
      allowedUserIds: [],
    });

    await addTransaction('account-1', 'cat-1', -500, 'Telegram Bot');

    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.addTransactions).toHaveBeenCalledBefore(mocks.sync);
  });

  it('rotates backups keeping only last 5', async () => {
    mocks.loadConfig.mockReturnValue({
      telegramBotToken: 'test-token',
      actualServerUrl: 'http://localhost:5006',
      actualPassword: 'test-password',
      actualSyncId: 'test-sync-id',
      accounts: [{ name: 'Default', id: 'test-account-id' }],
      actualDataDir: testDir,
      actualFilePassword: undefined,
      actualPayeeName: 'Telegram Bot',
      allowedUserIds: [],
    });

    const backupDir = join(testDir, 'backups');
    mkdirSync(backupDir, { recursive: true });
    for (let i = 1; i <= 6; i++) {
      const dir = join(backupDir, `backup-2026-01-0${i}T00-00-00-000Z`);
      mkdirSync(dir);
      writeFileSync(join(dir, 'test.sqlite'), 'data');
    }

    await addTransaction('account-1', 'cat-1', -100, 'Telegram Bot');

    const backups = readdirSync(backupDir).filter((d) => d.startsWith('backup-'));
    expect(backups.length).toBeLessThanOrEqual(5);
  });
});
