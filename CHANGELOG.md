# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.3] - 2026-07-20

### Fixed

- **Prevent duplicate transactions on category update failure** — Wrapped `api.updateTransaction` in try/catch so a category update failure after a successful `addTransactions` does not reject the save and trigger a retry.

## [1.4.2] - 2026-07-20

### Fixed

- **Redacted sensitive data from transaction logs** — Removed `payeeName` and `amountInCents` from console output to prevent leaking personal financial data in logs.

## [1.4.1] - 2026-07-20

### Fixed

- **OCR edit buttons always visible** — When AI recognizes a screenshot but fails to match a category, the bot now shows the full OCR suggestion screen (with Edit Amount and Change Category buttons) instead of only a category selection list. This ensures users can always correct the AI-recognized amount.
- **Block confirm without category** — The Confirm button now validates that a category is selected before saving, preventing empty-category transactions.

### Changed

- `src/index.ts` — Path 2 (amount found, no category) now calls `sendOcrSuggestion` instead of `sendCategorySelection`, providing a consistent editing experience.

## [1.4.0] - 2026-07-19

### Added

- **OCR + AI Screenshot Processing** — Send a payment screenshot to the bot and it will extract the amount using OCR (tesseract.js), then use AI (Ollama or OpenAI) to match it to an existing Actual Budget category. User confirms before saving.
- **Caption Override** — Send a screenshot with a caption like `15.50` to override the AI-detected amount.
- **Amount Confidence Indicator** — When OCR detects multiple amounts in a screenshot, a warning is shown so the user can verify.
- **Auto-Categorization Rules** — Save rules (merchant pattern → category) so future similar screenshots are matched instantly without calling AI. Rules are stored locally in `ocr-rules.json`.
- **`/rules` Command** — List and delete saved rules via inline keyboard.
- New files: `src/ocr.ts` (OCR + AI pipeline), `src/rules.ts` (rules store).
- New test files: `test/ocr.test.ts` (17 tests), `test/rules.test.ts` (13 tests).
- New env vars: `AI_PROVIDER`, `OLLAMA_URL`, `OLLAMA_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OCR_LANGUAGE`, `OCR_CACHE_DIR`.

### Changed

- `src/config.ts` — `AppConfig` extended with OCR/AI fields (all optional, feature disabled when `AI_PROVIDER` unset).
- `src/index.ts` — Added photo handler, OCR confirmation callbacks, `/rules` command, OCR edit mode in text handler.
- `package.json` — Added `tesseract.js` dependency.

## [1.3.1] - 2026-07-18

### Changed

- **Security Improvement** — If `ALLOWED_TELEGRAM_USER_IDS` is not set, the bot will now block all interactions and reply with instructions to configure the ID using `@RawDataBot`, instead of leaving the bot open to anyone. A warning is also printed on startup.
## [1.3.0] - 2026-07-18

### Added

- **Multiple account support** — configure multiple Actual Budget accounts via `ACTUAL_ACCOUNTS` env var (format: `name:uuid,name:uuid`). When multiple accounts are configured, the bot shows an inline keyboard to select the account before category selection.
- `src/actual.ts` — new `getAccounts()` function wrapping `api.getAccounts()`, filtering out closed accounts.
- `src/config.ts` — new `AccountEntry` interface and `parseAccounts()` helper. `AppConfig.accounts` replaces `actualDefaultAccountId`.
- `src/index.ts` — account selection step in FSM (between amount input and category selection). Single-account setups auto-select with no UX change.
- New env var `ACTUAL_ACCOUNTS` — comma-separated `name:uuid` pairs.

### Changed

- `ACTUAL_DEFAULT_ACCOUNT_ID` is now a fallback — if `ACTUAL_ACCOUNTS` is set, it takes precedence. Existing single-account setups continue to work without config changes.
- `src/index.ts` — `SessionData` now includes `accountId`. Category handler validates both `amountInCents` and `accountId` from session.

## [1.2.1] - 2026-07-18

### Fixed

- Disabled credential persistence in CI checkout actions (`persist-credentials: false`).
- Corrected CHANGELOG test count for utils.test.ts (39 → 32).
- Added vitest and test script to `package.json` (missing from devDependencies).
- Exported `readSecret`, `requireSecret`, `optional` from `src/config.ts` (tests expected exports).

### Changed

- Used secure `umask 077` + prompted `printf` pattern for secret-file creation in README.md and TESTING.md.
- Aligned backup verification path in TESTING.md (added Docker path alongside local path).
- Added `*_FILE` environment variable mappings in `docker-compose.yml` for Docker secrets.
- Set `module` and `moduleResolution` to `node16` in `tsconfig.json`.
- `src/actual.ts` — `finalize()` now uses try/finally to ensure API shutdown even if sync fails.
- `src/actual.ts` — `createBackup()` now traverses full dataDir tree recursively.
- `src/actual.ts` — Backup rotation now logs errors instead of silently swallowing them.
- `src/index.ts` — Added in-flight guard (`pendingTransactions` Set) to prevent duplicate transaction submissions.
- `src/utils.ts` — `parseUserIds()` now validates tokens as positive safe integers, throws on malformed input.
- `src/utils.ts` — `parseAmountToCents()` now validates entire input, distinguishes decimal from thousands separators.
- `src/index.ts` — Signal handlers registered before `bot.launch()`, which is now awaited.
- `.gitignore` — Added `backup/` and `tofix-helper` files.

## [1.2.0] - 2026-07-17

### Added

- Docker testing instructions in TESTING.md (Option A: .env only, Option B: Docker secrets).
- `secrets/` directory with placeholder files for Docker secrets.

### Changed

- `.env.example` updated with new variables (ACTUAL_FILE_PASSWORD, ACTUAL_PAYEE_NAME, ALLOWED_TELEGRAM_USER_IDS).

## [1.1.0] - 2026-07-17

### Added

- Comprehensive test suite with 66 tests (vitest).
- `src/utils.ts` — extracted `parseAmountToCents` and `parseUserIds` for testability.
- `test/utils.test.ts` — 32 tests for amount parsing and user ID parsing.
- `test/config.test.ts` — 8 tests for config loading and secret reading.
- `test/actual.test.ts` — 11 tests for API integration (mocked).
- `test/index.test.ts` — 15 tests for bot logic.
- `TESTING.md` — step-by-step manual testing guide.
- `vitest.config.ts` — test configuration.

### Changed

- `src/config.ts` — exported helper functions, imported `parseUserIds` from utils.
- `src/index.ts` — imported `parseAmountToCents` from utils.

## [1.0.0] - 2026-07-17

### Added

- `src/config.ts` — centralized config validator with Docker secrets support (`_FILE` suffix).
- `finalize()` function — `sync()` + `shutdown()` for graceful shutdown.
- Pre-write SQLite backups with rotation (max 5 backups).
- `ACTUAL_FILE_PASSWORD` support for encrypted budget files.
- `ACTUAL_PAYEE_NAME` configurable payee on transactions.
- `ALLOWED_TELEGRAM_USER_IDS` access control.
- Docker secrets support in `docker-compose.yml`.
- `version.txt` for version tracking.

### Changed

- `src/actual.ts` — rewrote with sync-after-write, backup-before-write lifecycle.
- `src/index.ts` — removed all `any` types, added access control middleware, graceful shutdown.
- `docker-compose.yml` — removed deprecated `version` key, added Docker secrets section.
- `Dockerfile` — upgraded from Node 20 to Node 22 alpine.
- `package.json` — upgraded `@actual-app/api` from `^6.10.1` to `^26.7.0`.

### Fixed

- Missing `sync()` call after `addTransaction()` (data loss on restart).
- Missing `shutdown()` on process exit.
- TypeScript `any` types in category filtering.
- No access control on bot usage.
- No pre-write backup mechanism.
- No encrypted budget file support.
- Deprecated Docker Compose `version` key.
- Outdated `@actual-app/api` version (v6 no longer exists on npm).

## [0.1.0] - 2026-07-17

### Added

- Initial project setup with TypeScript, Telegraf, `@actual-app/api`.
- `src/index.ts` — Telegram bot with FSM for expense logging.
- `src/actual.ts` — Actual Budget API integration.
- Docker setup (`Dockerfile`, `docker-compose.yml`).
- CI/CD workflow (`.github/workflows/ci.yml`).
- Project documentation (`README.md`, `INSTRUCTIONS.md`).
