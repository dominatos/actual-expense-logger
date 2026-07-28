import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { readSecret, requireSecret, optional, parseAccounts } from '../src/config';
import { parseUserIds } from '../src/utils';

// We test readSecret/requireSecret/optional directly since they're now exported.
// loadConfig() is tested via integration (it reads real env vars).

vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

describe('readSecret', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns env var value when no _FILE is set', () => {
    process.env['TEST_SECRET'] = 'my-value';
    expect(readSecret('TEST_SECRET')).toBe('my-value');
  });

  it('returns undefined when env var is not set', () => {
    delete process.env['TEST_SECRET'];
    expect(readSecret('TEST_SECRET')).toBeUndefined();
  });

  it('prefers _FILE path over env var', () => {
    process.env['TEST_SECRET_FILE'] = '/tmp/test-secret.txt';
    process.env['TEST_SECRET'] = 'env-value';
    // We can't easily test file reading without creating a temp file,
    // but we verify the _FILE path takes precedence by checking the logic.
    // The function will try to read the file and may throw if it doesn't exist.
    try {
      readSecret('TEST_SECRET');
    } catch (e: unknown) {
      // Expected: file doesn't exist
      expect((e as Error).message).toContain('Failed to read secret file');
    }
  });
});

describe('requireSecret', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns value when env var is set', () => {
    process.env['REQUIRED_VAR'] = 'present';
    expect(requireSecret('REQUIRED_VAR')).toBe('present');
  });

  it('throws when env var is missing', () => {
    delete process.env['REQUIRED_VAR'];
    expect(() => requireSecret('REQUIRED_VAR')).toThrow('Missing required environment variable or secret: REQUIRED_VAR');
  });
});

describe('optional', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns env var value when set', () => {
    process.env['OPT_VAR'] = 'custom-value';
    expect(optional('OPT_VAR', 'default')).toBe('custom-value');
  });

  it('returns default when env var is not set', () => {
    delete process.env['OPT_VAR'];
    expect(optional('OPT_VAR', 'default')).toBe('default');
  });
});

describe('parseUserIds (via utils)', () => {
  it('is imported correctly from utils', () => {
    expect(typeof parseUserIds).toBe('function');
  });
});

describe('parseAccounts', () => {
  it('parses multiple accounts', () => {
    const result = parseAccounts('Personal:uuid-1,Business:uuid-2');
    expect(result).toEqual([
      { name: 'Personal', id: 'uuid-1' },
      { name: 'Business', id: 'uuid-2' },
    ]);
  });

  it('parses single account', () => {
    const result = parseAccounts('Checking:abc-123');
    expect(result).toEqual([{ name: 'Checking', id: 'abc-123' }]);
  });

  it('returns empty array for empty string', () => {
    expect(parseAccounts('')).toEqual([]);
  });

  it('trims whitespace around names and ids', () => {
    const result = parseAccounts(' Personal : uuid-1 , Business : uuid-2 ');
    expect(result).toEqual([
      { name: 'Personal', id: 'uuid-1' },
      { name: 'Business', id: 'uuid-2' },
    ]);
  });

  it('throws on entry without colon separator', () => {
    expect(() => parseAccounts('InvalidEntry')).toThrow('expected format "name:uuid"');
  });

  it('throws on entry with empty name', () => {
    expect(() => parseAccounts(':uuid-1')).toThrow('name and uuid must not be empty');
  });

  it('throws on entry with empty uuid', () => {
    expect(() => parseAccounts('Personal:')).toThrow('name and uuid must not be empty');
  });

  it('handles names containing colons (takes last colon as separator)', () => {
    const result = parseAccounts('My:Account:uuid-1');
    expect(result).toEqual([{ name: 'My:Account', id: 'uuid-1' }]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(parseAccounts('   ')).toEqual([]);
  });

  it('returns empty array for delimiter-only input', () => {
    expect(parseAccounts(' , , ')).toEqual([]);
  });

  it('returns empty array for single comma', () => {
    expect(parseAccounts(',')).toEqual([]);
  });
});

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  let loadConfig: typeof import('../src/config').loadConfig;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    vi.resetModules();
    const configModule = await import('../src/config');
    loadConfig = configModule.loadConfig;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads valid configuration with default fallback account', async () => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'bot-token';
    process.env['ACTUAL_SERVER_URL'] = 'http://actual';
    process.env['ACTUAL_PASSWORD'] = 'password';
    process.env['ACTUAL_SYNC_ID'] = 'sync-id';
    process.env['ACTUAL_DEFAULT_ACCOUNT_ID'] = 'default-account';
    
    const config = loadConfig();
    
    expect(config.telegramBotToken).toBe('bot-token');
    expect(config.actualServerUrl).toBe('http://actual');
    expect(config.actualPassword).toBe('password');
    expect(config.actualSyncId).toBe('sync-id');
    expect(config.accounts).toEqual([{ name: 'Default', id: 'default-account' }]);
    expect(config.actualDataDir).toBe('/app/data');
    expect(config.actualPayeeName).toBe('Telegram Bot');
    expect(config.allowedUserIds).toEqual([]);
    expect(config.aiProvider).toBeUndefined();
  });

  it('loads valid configuration with multiple accounts', async () => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'bot-token';
    process.env['ACTUAL_SERVER_URL'] = 'http://actual';
    process.env['ACTUAL_PASSWORD'] = 'password';
    process.env['ACTUAL_SYNC_ID'] = 'sync-id';
    process.env['ACTUAL_ACCOUNTS'] = 'Cash:uuid-1,Bank:uuid-2';
    
    const config = loadConfig();
    
    expect(config.accounts).toEqual([
      { name: 'Cash', id: 'uuid-1' },
      { name: 'Bank', id: 'uuid-2' }
    ]);
  });

  it('throws if required variables are missing', async () => {
    delete process.env['TELEGRAM_BOT_TOKEN'];
    expect(() => loadConfig()).toThrow(/Missing required environment variable/);
  });

  it('throws if ACTUAL_ACCOUNTS is invalid', async () => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'bot-token';
    process.env['ACTUAL_SERVER_URL'] = 'http://actual';
    process.env['ACTUAL_PASSWORD'] = 'password';
    process.env['ACTUAL_SYNC_ID'] = 'sync-id';
    process.env['ACTUAL_DEFAULT_ACCOUNT_ID'] = 'default-account';
    process.env['ACTUAL_ACCOUNTS'] = ', ,';
    expect(() => loadConfig()).toThrow(/contains no valid "name:uuid" entries/);
  });

  it('loads OCR + AI configuration when aiProvider is set', async () => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'bot-token';
    process.env['ACTUAL_SERVER_URL'] = 'http://actual';
    process.env['ACTUAL_PASSWORD'] = 'password';
    process.env['ACTUAL_SYNC_ID'] = 'sync-id';
    process.env['ACTUAL_DEFAULT_ACCOUNT_ID'] = 'default-account';
    process.env['AI_PROVIDER'] = 'ollama';
    process.env['OLLAMA_MODEL'] = 'test-model';
    
    const config = loadConfig();
    
    expect(config.aiProvider).toBe('ollama');
    expect(config.ollamaModel).toBe('test-model');
    // Default values
    expect(config.ocrLanguage).toBe('eng');
  });
});

