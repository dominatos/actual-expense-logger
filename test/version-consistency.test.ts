import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = process.cwd();

function read(relPath: string): string {
  return readFileSync(resolve(root, relPath), 'utf8');
}

describe('Version consistency across project files', () => {
  const packageJson = JSON.parse(read('package.json'));
  const versionTxt = read('version.txt').trim();

  it('version.txt follows semantic versioning format', () => {
    expect(versionTxt).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('package.json version matches version.txt', () => {
    expect(packageJson.version).toBe(versionTxt);
  });

  it('CHANGELOG.md has a dated entry for the current version', () => {
    const changelog = read('CHANGELOG.md');
    expect(changelog).toMatch(new RegExp(`## \\[${versionTxt.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}`));
  });

  it('README.md status line references the current version', () => {
    const readme = read('README.md');
    expect(readme).toContain(`v${versionTxt}`);
  });
});

describe('CHANGELOG.md entry for the access-control security fix', () => {
  const changelog = read('CHANGELOG.md');
  // Isolate the section for version 1.3.1 (up to the next version heading)
  const section = changelog.split('## [1.3.1]')[1]?.split(/## \[/)[0] ?? '';

  it('includes a [1.3.1] section', () => {
    expect(changelog).toContain('## [1.3.1]');
  });

  it('documents the security improvement for ALLOWED_TELEGRAM_USER_IDS', () => {
    expect(section).toContain('ALLOWED_TELEGRAM_USER_IDS');
    expect(section).toMatch(/Security Improvement/i);
  });

  it('mentions that the bot blocks all interactions when unset', () => {
    expect(section).toMatch(/block all interactions/i);
  });

  it('mentions the startup warning behavior', () => {
    expect(section).toMatch(/warning is also printed on startup/i);
  });
});

describe('.env.example documentation for ALLOWED_TELEGRAM_USER_IDS', () => {
  const envExample = read('.env.example');

  it('still declares the ALLOWED_TELEGRAM_USER_IDS variable', () => {
    expect(envExample).toMatch(/^ALLOWED_TELEGRAM_USER_IDS=\s*$/m);
  });

  it('documents the variable as security-relevant', () => {
    expect(envExample).toMatch(/# Security:.*ALLOWED_TELEGRAM_USER_IDS|Security:.*your Telegram user ID/i);
  });

  it('warns that an empty value blocks all interactions', () => {
    const lines = envExample.split('\n');
    const idx = lines.findIndex((l) => l.trim() === 'ALLOWED_TELEGRAM_USER_IDS=');
    expect(idx).toBeGreaterThan(-1);
    // The preceding comment lines should mention the blocking behavior
    const precedingComments = lines.slice(Math.max(0, idx - 2), idx).join('\n');
    expect(precedingComments).toMatch(/block all interactions/i);
  });
});

describe('README.md documentation for ALLOWED_TELEGRAM_USER_IDS', () => {
  const readme = read('README.md');

  it('marks ALLOWED_TELEGRAM_USER_IDS as required in the variables table', () => {
    const tableLine = readme.split('\n').find((l) => l.includes('| `ALLOWED_TELEGRAM_USER_IDS` |'));
    expect(tableLine).toBeDefined();
    expect(tableLine).toMatch(/\|\s*Yes\s*\|/);
  });

  it('explains that the bot blocks all users when the variable is empty', () => {
    const tableLine = readme.split('\n').find((l) => l.includes('| `ALLOWED_TELEGRAM_USER_IDS` |'));
    expect(tableLine).toMatch(/blocks all if empty/i);
  });
});