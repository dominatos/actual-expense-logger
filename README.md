# Actual Budget Telegram Bot

> **Status:** v1.2.1 — Tested with 66 unit tests and Docker deployment.

A Telegram bot written in TypeScript that integrates with the [Actual Budget](https://actualbudget.org/) API (`@actual-app/api`).

This bot allows you to quickly log expenses into Actual Budget directly from Telegram. It parses amounts, fetches your budget categories, and records a transaction in a default account.

## Features
- **Fast Expense Logging:** Send a number like `15`, `15.50`, or `15,5` to the bot.
- **International Formats:** Supports US (`1,234.56`) and European (`1.234,56`) number formats.
- **Category Selection:** An inline keyboard appears allowing you to pick a category for the expense.
- **Idempotent Transactions:** In-flight guard prevents duplicate submissions from double-taps.
- **Safety-First Design:** Every transaction is backed up recursively, then synced to the server immediately.
- **Access Control:** Optionally restrict bot usage to specific Telegram user IDs (validates input at startup).
- **Docker Secrets:** Sensitive credentials can be injected via Docker secrets instead of `.env` files.
- **Encrypted Budgets:** Supports Actual Budget file encryption via `ACTUAL_FILE_PASSWORD`.
- **Graceful Shutdown:** SIGINT/SIGTERM handlers ensure sync + shutdown always run (try/finally).

## Prerequisites
- Node.js (v22+) if running locally.
- Docker & Docker Compose (Recommended).
- A self-hosted Actual Budget server.
- A Telegram Bot Token (obtain from [@BotFather](https://t.me/botfather)).

## Environment Variables
Create a `.env` file in the project root:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
ACTUAL_SERVER_URL=https://your-actual-server.example.com
ACTUAL_PASSWORD=your_actual_password
ACTUAL_SYNC_ID=your_actual_sync_id
ACTUAL_DEFAULT_ACCOUNT_ID=your_account_id
ACTUAL_DATA_DIR=/app/data
ACTUAL_FILE_PASSWORD=your_budget_encryption_password
ACTUAL_PAYEE_NAME=Telegram Bot
ALLOWED_TELEGRAM_USER_IDS=
```

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram Bot API token |
| `ACTUAL_SERVER_URL` | Yes | URL of your Actual Budget server |
| `ACTUAL_PASSWORD` | Yes | Actual Budget server password |
| `ACTUAL_SYNC_ID` | Yes | Budget sync ID (Settings > Advanced > Sync ID) |
| `ACTUAL_DEFAULT_ACCOUNT_ID` | Yes | Account ID for new transactions |
| `ACTUAL_DATA_DIR` | No (default `/app/data`) | Local cache directory for budget data |
| `ACTUAL_FILE_PASSWORD` | No | Password for encrypted budget files |
| `ACTUAL_PAYEE_NAME` | No (default `Telegram Bot`) | Payee name on created transactions |
| `ALLOWED_TELEGRAM_USER_IDS` | No (empty = open) | Comma-separated Telegram user IDs to allow |

## Docker Secrets (Production)

For production, sensitive values can be injected via Docker secrets instead of `.env`:

1. Create a `secrets/` directory with restricted permissions:
   ```bash
   mkdir -p secrets
   umask 077
   printf "Enter Telegram bot token: " && read -r token && printf "%s" "$token" > secrets/telegram_bot_token.txt
   printf "Enter Actual password: " && read -r pass && printf "%s" "$pass" > secrets/actual_password.txt
   printf "Enter file password (empty if none): " && read -r fp && printf "%s" "$fp" > secrets/actual_file_password.txt
   ```

   > **Warning:** Do not commit the `secrets/` directory to version control. It is already in `.gitignore`.

2. The `docker-compose.yml` maps these to `/run/secrets/` in the container. The bot automatically reads `<VAR>_FILE` env vars pointing to secret files, falling back to `.env` for local development.

## Running with Docker (Recommended)

This project includes a `Dockerfile` and `docker-compose.yml` for easy deployment. The bot's local cache (used by Actual to sync) is persisted in a named volume so that restarting the container doesn't force a full re-download.

1. Ensure `.env` is properly configured.
2. Run `docker compose up -d --build` to start the bot in the background.
3. Check logs with `docker compose logs -f`.

## Running Locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the TypeScript code:
   ```bash
   npm run build
   ```
3. Run the bot:
   ```bash
   npm start
   ```
   Or run in dev mode using `ts-node`:
   ```bash
   npm run dev
   ```

## Transaction Safety

Every transaction follows this lifecycle:
1. **Backup** — Database files are copied recursively to `<data_dir>/backups/backup-<timestamp>/`
2. **Write** — Transaction is added via the Actual API
3. **Sync** — Changes are immediately synced to the server
4. **Rotate** — Only the last 5 backups are kept (errors are logged)

On shutdown (`SIGINT`/`SIGTERM`), the bot calls `sync()` + `shutdown()` in a try/finally block to ensure no data is lost, even if sync fails.

Duplicate submissions are prevented by an in-flight guard — if a transaction is already being processed, subsequent taps are rejected.

## Development Workflow with AI
This repository uses the `INSTRUCTIONS.md` and `prompt.txt` workflow for AI-assisted development. Paste the contents of `prompt.txt` into an AI chat session to set the context and rules for modifications.
