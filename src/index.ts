import { Telegraf, session, Context } from 'telegraf';
import { loadConfig } from './config';
import { initActual, getCategories, addTransaction, finalize } from './actual';
import { parseAmountToCents } from './utils';

// --- Types ---

interface SessionData {
  amountInCents?: number;
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

// In-memory session for FSM state (amount -> category selection)
bot.use(session());

// Access control: if ALLOWED_TELEGRAM_USER_IDS is set, only those users can use the bot
if (config.allowedUserIds.length > 0) {
  bot.use((ctx, next) => {
    if (ctx.from && config.allowedUserIds.includes(ctx.from.id)) {
      return next();
    }
    // Silently ignore unauthorized users
  });
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

    const categories = await getCategories();

    // Build inline keyboard: 2 buttons per row
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
  } catch (error) {
    console.error('Error in text handler:', error);
    ctx.reply('Failed to fetch categories. Please ensure the bot is synced.');
  }
});

// Step 2: Category selection
bot.action(/^cat_(.+)$/, async (ctx) => {
  try {
    const categoryId = ctx.match[1];
    const amountInCents = ctx.session?.amountInCents;

    if (amountInCents === undefined) {
      await ctx.answerCbQuery('Session expired. Please send the amount again.', { show_alert: true });
      return;
    }

    await ctx.answerCbQuery('Saving transaction...');

    // createTransaction: backup -> addTransaction -> sync
    await addTransaction(config.actualDefaultAccountId, categoryId, amountInCents, config.actualPayeeName);

    if (ctx.session) {
      ctx.session.amountInCents = undefined;
    }

    const displayAmount = (Math.abs(amountInCents) / 100).toFixed(2);
    await ctx.editMessageText(`Transaction of ${displayAmount} saved successfully!`);
  } catch (error) {
    console.error('Error adding transaction:', error);
    await ctx.reply('Failed to save the transaction.');
  }
});

// --- Startup ---

async function start(): Promise<void> {
  try {
    await initActual();
    console.log('Starting Telegram bot...');
    bot.launch();

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

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

start();
