# Actual Budget Telegram Bot

A production-ready Telegram bot written in TypeScript that integrates with the [Actual Budget](https://actualbudget.org/) API (`@actual-app/api`).

This bot allows you to quickly log expenses into Actual Budget directly from Telegram. It parses amounts, fetches your budget categories, and records a transaction in a default account.

## Features
- **Fast Expense Logging:** Send a number like `15`, `15.50`, or `15,5` to the bot.
- **Category Selection:** An inline keyboard appears allowing you to pick a category for the expense.
- **Robust Integration:** Uses the official `@actual-app/api` to sync with your self-hosted Actual Budget server.

## Prerequisites
- Node.js (v18+) if running locally.
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
```

## Running with Docker (Recommended)

This project includes a `Dockerfile` and `docker-compose.yml` for easy deployment. The bot's local cache (used by Actual to sync) is persisted in a named volume so that restarting the container doesn't force a full re-download.

1. Ensure `.env` is properly configured.
2. Run `docker-compose up -d --build` to start the bot in the background.
3. Check logs with `docker-compose logs -f`.

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

## Development Workflow with AI
This repository uses the `INSTRUCTIONS.md` and `prompt.txt` workflow for AI-assisted development. Paste the contents of `prompt.txt` into an AI chat session to set the context and rules for modifications.
