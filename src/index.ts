import { Telegraf, session, Context } from 'telegraf';
import { loadConfig } from './config';
import { initActual, getCategories, getAccounts, addTransaction, finalize } from './actual';

// --- Types ---

interface SessionData {
  amountInCents?: number;
  accountId?: string;
}

interface BotContext extends Context {
  session?: SessionData;
}

interface Category {
  id: string;
  name: string;
  is_income: boolean;
  hidden: boolean;
  group_id: string;
}

// --- Load config (validates all env vars at startup) ---

const config = loadConfig();

// --- Bot setup ---

const bot = new Telegraf<BotContext>(config.telegramBotToken);

// In-memory session for FSM state (amount -> [account ->] category selection)
bot.use(session());

export function createAccessControlMiddleware(allowedUserIds: number[]) {
  if (allowedUserIds.length === 0) {
    console.warn("WARNING: Bot started without ALLOWED_TELEGRAM_USER_IDS set! It is a bad idea to run without setting this parameter.");
    return async (ctx: Context, next: () => Promise<void>) => {
      try {
        await ctx.reply("ALLOWED_TELEGRAM_USER_IDS parameter is not set. Operation not possible. Please go to @RawDataBot to get your ID and fill the parameters in your environment configuration.");
      } catch (e) {
        console.error("Failed to send warning message:", e);
      }
      // Do not call next() to block further execution
    };
  }

  return async (ctx: Context, next: () => Promise<void>) => {
    if (ctx.from && allowedUserIds.includes(ctx.from.id)) {
      return next();
    }
    // Silently ignore unauthorized users
  };
}

// Access control: if ALLOWED_TELEGRAM_USER_IDS is set, only those users can use the bot
bot.use(createAccessControlMiddleware(config.allowedUserIds));

// --- Amount parsing ---

/**
 * Parse a user-provided amount string into negative cents for Actual Budget.
 * Handles: "15" -> -1500, "15.50" -> -1550, "15,5" -> -1550, "42.00-" -> -4200
 * Ignores currency symbols, spaces, and other non-numeric characters.
 */
function parseAmountToCents(text: string): number | null {
  const match = text.match(/[-]?\d+([.,]\d+)?-?/);
  if (!match) return null;

  let numStr = match[0].replace(',', '.');
  if (numStr.endsWith('-')) {
    numStr = '-' + numStr.slice(0, -1);
  }

  const parsed = parseFloat(numStr);
  if (isNaN(parsed)) return null;

  // Convert to negative cents (expense)
  const cents = Math.round(Math.abs(parsed) * 100);
  return -cents;
}

// --- Error handler ---

bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
  ctx.reply('An unexpected error occurred. Please try again.').catch(console.error);
});

// --- Commands ---

bot.start((ctx) => {
  ctx.reply('Welcome! Send me an expense amount (e.g. 15.50 or 42) to add a transaction.');
});

// Helper: show category selection keyboard
async function sendCategorySelection(ctx: BotContext, amountInCents: number): Promise<void> {
  const categories = await getCategories();

  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
  let row: Array<{ text: string; callback_data: string }> = [];

  for (const cat of categories) {
    row.push({ text: cat.name, callback_data: `cat_${cat.id}` });
    if (row.length === 2) {
      buttons.push(row);
      row = [];
    }
  }
  if (row.length > 0) {
    buttons.push(row);
  }

  const displayAmount = (Math.abs(amountInCents) / 100).toFixed(2);

  await ctx.reply(`Amount: ${displayAmount}\nPlease select a category:`, {
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
}

// Step 1: Amount input
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const amountInCents = parseAmountToCents(text);

  if (amountInCents === null) {
    return ctx.reply('Please send a valid amount (e.g., 15.50 or 15,5).');
  }

  try {
    ctx.session ??= {};
    ctx.session.amountInCents = amountInCents;

    const accounts = config.accounts;

    if (accounts.length === 1) {
      // Single account: auto-select and go straight to categories
      ctx.session.accountId = accounts[0].id;
      await sendCategorySelection(ctx, amountInCents);
    } else {
      // Multiple accounts: show account selection first
      const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
      let row: Array<{ text: string; callback_data: string }> = [];

      for (const account of accounts) {
        row.push({ text: account.name, callback_data: `acc_${account.id}` });
        if (row.length === 2) {
          buttons.push(row);
          row = [];
        }
      }
      if (row.length > 0) {
        buttons.push(row);
      }

      const displayAmount = (Math.abs(amountInCents) / 100).toFixed(2);

      await ctx.reply(`Amount: ${displayAmount}\nPlease select an account:`, {
        reply_markup: {
          inline_keyboard: buttons,
        },
      });
    }
  } catch (error) {
    console.error('Error in text handler:', error);
    ctx.reply('Failed to fetch accounts. Please ensure the bot is synced.');
  }
});

// In-flight guard: prevent duplicate transaction submissions
const pendingTransactions = new Set<string>();

// Step 2: Account selection (only when multiple accounts are configured)
bot.action(/^acc_(.+)$/, async (ctx) => {
  try {
    const accountId = ctx.match[1];
    const amountInCents = ctx.session?.amountInCents;

    if (amountInCents === undefined) {
      await ctx.answerCbQuery('Session expired. Please send the amount again.', { show_alert: true });
      return;
    }

    if (ctx.session) {
      ctx.session.accountId = accountId;
    }

    await ctx.answerCbQuery();

    // Now show category selection
    const accountName = config.accounts.find((a) => a.id === accountId)?.name ?? accountId;
    await ctx.editMessageText(`Account: ${accountName}`);
    await sendCategorySelection(ctx, amountInCents);
  } catch (error) {
    console.error('Error in account selection:', error);
    await ctx.reply('Failed to process account selection. Please try again.');
  }
});

// Step 3: Category selection
bot.action(/^cat_(.+)$/, async (ctx) => {
  const submissionKey = `${ctx.chat?.id ?? 'unknown'}_${ctx.session?.amountInCents ?? 'none'}`;

  if (pendingTransactions.has(submissionKey)) {
    await ctx.answerCbQuery('Transaction already in progress. Please wait.', { show_alert: true });
    return;
  }

  try {
    const categoryId = ctx.match[1];
    const amountInCents = ctx.session?.amountInCents;
    const accountId = ctx.session?.accountId;

    if (amountInCents === undefined || accountId === undefined) {
      await ctx.answerCbQuery('Session expired. Please send the amount again.', { show_alert: true });
      return;
    }

    pendingTransactions.add(submissionKey);
    await ctx.answerCbQuery('Saving transaction...');

    // createTransaction: backup -> addTransaction -> sync
    await addTransaction(accountId, categoryId, amountInCents, config.actualPayeeName);

    if (ctx.session) {
      ctx.session.amountInCents = undefined;
      ctx.session.accountId = undefined;
    }

    const displayAmount = (Math.abs(amountInCents) / 100).toFixed(2);
    await ctx.editMessageText(`Transaction of ${displayAmount} saved successfully!`);
  } catch (error) {
    console.error('Error adding transaction:', error);
    await ctx.reply('Failed to save the transaction.');
  } finally {
    pendingTransactions.delete(submissionKey);
  }
});

// --- Startup ---

async function start(): Promise<void> {
  try {
    await initActual();

    // Graceful shutdown: sync + shutdown Actual API, then stop bot
    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}. Shutting down gracefully...`);
      bot.stop(signal);
      try {
        await finalize();
      } catch (err) {
        console.error('Error during finalize:', err);
      }
      process.exit(0);
    };

    // Register signal handlers before launch to catch early failures
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    console.log('Starting Telegram bot...');
    await bot.launch();
    console.log('Bot is running.');
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  start();
}
