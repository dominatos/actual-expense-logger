# Testing Guide

> **DEV STATUS — NOT YET TESTED.** This guide explains how to test the bot locally without affecting your production budget.

## Prerequisites

- Node.js v22+ installed locally
- A running Actual Budget server (you already have one at `http://localhost:5006`)
- A Telegram Bot Token (for testing, create a **separate test bot**)

---

## Step 1: Create a Test Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/botfather)
2. Send `/newbot`
3. Choose a name: e.g. `Actual Expense Logger Test`
4. Choose a username: e.g. `actual_expense_test_bot`
5. BotFather gives you a **token** like: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`
6. Save this token — you'll put it in `.env`

---

## Step 2: Create a Test Budget in Actual Budget

1. Open your Actual Budget server at `http://localhost:5006`
2. Create a **new test budget** (don't use your real one):
   - Click "Add Budget" or "Create Budget"
   - Name it: `Test Budget`
   - Set a password (or leave empty)
3. Open the test budget
4. Go to **Settings > Advanced Settings** (gear icon > Advanced)
5. Find and copy the **Sync ID** (looks like: `1cfdbb80-6274-49bf-b0c2-737235a4c81f`)
6. Still in the test budget, create:
   - At least one **account** (e.g. "Test Cash Account")
   - At least one **category** (e.g. "Food", "Transport")
7. Copy the **Account ID**:
   - Open the account
   - Look at the URL: `http://localhost:5006/budgets/xxx/accounts/THIS_IS_THE_ID`
   - Or use the Actual Budget API: the account ID is a UUID

---

## Step 3: Configure `.env` for Testing

Create or edit `.env` in the project root with your test values:

```env
# Telegram Bot Token (from Step 1)
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

# Actual Budget Server (your local server)
ACTUAL_SERVER_URL=http://localhost:5006

# Actual Budget Password (the budget password, NOT the server password)
ACTUAL_PASSWORD=your_actual_password_here

# Sync ID (from Step 2 — Settings > Advanced)
ACTUAL_SYNC_ID=1cfdbb80-6274-49bf-b0c2-737235a4c81f

# Account ID (from Step 2 — the test account UUID)
ACTUAL_DEFAULT_ACCOUNT_ID=your-test-account-uuid-here

# Data directory for local cache (use a temp path for testing)
ACTUAL_DATA_DIR=/tmp/actual-test-data

# Optional: only allow your own Telegram user ID
# Find your ID: message @userinfobot on Telegram
ALLOWED_TELEGRAM_USER_IDS=

# Optional: payee name on transactions
ACTUAL_PAYEE_NAME=Test Bot
```

---

## Step 4: Run Unit Tests

The project has **66 unit tests** covering all core logic. Run them with:

```bash
npm test
```

This runs tests against mocked APIs — no real server connection needed.

**What's tested:**
- `test/utils.test.ts` — Amount parsing (32 tests), user ID parsing (7 tests)
- `test/config.test.ts` — Config loading, secret reading, environment validation (8 tests)
- `test/actual.test.ts` — API init, finalize, category filtering, transaction creation with backup (11 tests)
- `test/index.test.ts` — Bot logic: amount formatting, access control, keyboard layout (15 tests)

---

## Step 5: Run the Bot Locally

```bash
# Install dependencies (if not done)
npm install

# Build TypeScript
npm run build

# Start the bot
npm start
```

Or in dev mode (auto-rebuilds on changes):
```bash
npm run dev
```

---

## Step 6: Test the Bot in Telegram

1. Open your test bot in Telegram (search for the username you created)
2. Send `/start`
   - **Expected:** Welcome message
3. Send a number: `15.50`
   - **Expected:** Reply with "Amount: 15.50" and category buttons
4. Click a category button
   - **Expected:** Reply with "Transaction of 15.50 saved successfully!"
5. Check Actual Budget:
   - Open your test budget
   - The transaction should appear in the account you configured
   - Payee should be "Test Bot" (or your configured `ACTUAL_PAYEE_NAME`)

---

## Step 7: Test Edge Cases

| Input | Expected Result |
|-------|----------------|
| `15` | -1500 cents, shown as "15.00" |
| `15.50` | -1550 cents, shown as "15.50" |
| `15,5` | -1550 cents (comma handled) |
| `42.00-` | -4200 cents (trailing minus) |
| `$100` | -10000 cents (currency symbol ignored) |
| `hello` | "Please send a valid amount" |
| Empty session click | "Session expired" alert |

---

## Step 8: Test Access Control

1. Set `ALLOWED_TELEGRAM_USER_IDS=your_user_id` in `.env`
2. Restart the bot
3. Try from a different Telegram account
   - **Expected:** No response (silently ignored)
4. Try from your allowed account
   - **Expected:** Works normally

---

## Step 9: Test Docker Deployment

```bash
# Build and run
docker-compose up -d --build

# Check logs
docker-compose logs -f

# Test the bot in Telegram (same as Step 6)

# Stop
docker-compose down
```

---

## Step 10: Verify Backup Creation

1. Send a transaction via the bot
2. Check the data directory:
   ```bash
   ls -la /tmp/actual-test-data/backups/
   ```
3. You should see a `backup-<timestamp>/` directory containing:
   - `*.sqlite` files (the budget database snapshot)
   - `*-wal` files (Write-Ahead Log)
   - `*-shm` files (shared memory)
4. Send 6+ transactions
5. Verify only 5 backup directories remain (oldest rotated)

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Missing required environment variable` | Check `.env` has all required values |
| `Failed to read secret file` | If using Docker secrets, ensure `secrets/` directory exists with files |
| `ECONNREFUSED http://localhost:5006` | Ensure Actual Budget server is running |
| `Budget not found` | Check `ACTUAL_SYNC_ID` matches the test budget |
| Bot doesn't respond | Check `TELEGRAM_BOT_TOKEN` is correct, bot is not blocked |
| Transaction not showing | Check `ACTUAL_DEFAULT_ACCOUNT_ID` is the correct account UUID |

---

## Cleanup

After testing, remove test data:
```bash
rm -rf /tmp/actual-test-data
```

And delete the test budget from Actual Budget if no longer needed.
