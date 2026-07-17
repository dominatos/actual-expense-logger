import { Telegraf, session, Context } from 'telegraf';
import * as dotenv from 'dotenv';
import { initActual, getCategories, addTransaction } from './actual';

dotenv.config();

// Define session data structure
interface SessionData {
  amountInCents?: number;
}

// Extend Telegraf Context to include session
interface BotContext extends Context {
  session?: SessionData;
}

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined');
}

const defaultAccountId = process.env.ACTUAL_DEFAULT_ACCOUNT_ID;
if (!defaultAccountId) {
  throw new Error('ACTUAL_DEFAULT_ACCOUNT_ID is not defined');
}

const bot = new Telegraf<BotContext>(botToken);

// Use in-memory session to store state between amount input and category selection
bot.use(session());

/**
 * Bulletproof regex/parsing helper function for the amount.
 * - Handles: 10.5 or 10,5 -> -1050
 * - Handles: 10 -> -1000
 * - Handles: 42.00- -> -4200
 * - Explicitly ignores symbols like currency signs or spaces.
 */
function parseAmountToCents(text: string): number | null {
  // Match any digits with optional decimal point/comma, and optional minus signs
  const match = text.match(/[-]?\d+([.,]\d+)?-?/);
  if (!match) return null;

  // Replace comma with dot for standard JS parsing
  let numStr = match[0].replace(',', '.');

  // Move trailing minus to the front if present
  if (numStr.endsWith('-')) {
    numStr = '-' + numStr.slice(0, -1);
  }

  const parsed = parseFloat(numStr);
  if (isNaN(parsed)) return null;

  // Regardless of sign, convert to negative cents representing an expense
  const cents = Math.round(Math.abs(parsed) * 100);
  return -cents;
}

// Global error handler
bot.catch((err, ctx) => {
  console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
  ctx.reply('An unexpected error occurred. Please try again.').catch(console.error);
});

bot.start((ctx) => {
  ctx.reply('Welcome! Send me an expense amount (e.g. 15.50 or 42) to add a transaction.');
});

// Step 1: Amount Input handler
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const amountInCents = parseAmountToCents(text);

  if (amountInCents === null) {
    // If not a number, maybe it's just a general chat, but for this bot we just ask for a valid number.
    return ctx.reply('Please send a valid amount (e.g., 15.50 or 15,5).');
  }

  try {
    // Save amount in session state
    ctx.session ??= {};
    ctx.session.amountInCents = amountInCents;

    // Fetch categories from Actual Budget
    const categories = await getCategories();
    
    // Filter out hidden or system categories if needed, but for simplicity we list them.
    // Create inline keyboard buttons (max 2 per row for better mobile UI)
    const buttons = [];
    let row = [];
    
    // Sort categories by name alphabetically
    const sortedCategories = categories
      .filter((c: any) => !c.is_income && !c.hidden)
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    for (const cat of sortedCategories) {
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
        inline_keyboard: buttons
      }
    });

  } catch (error) {
    console.error('Error in text handler:', error);
    ctx.reply('Failed to fetch categories or process the amount. Please ensure the bot is synced.');
  }
});

// Step 2: Category Selection (Callback Query Handler)
bot.action(/^cat_(.+)$/, async (ctx) => {
  try {
    const categoryId = ctx.match[1];
    const amountInCents = ctx.session?.amountInCents;

    if (amountInCents === undefined) {
      await ctx.answerCbQuery('Session expired. Please send the amount again.', { show_alert: true });
      return;
    }

    // Acknowledge the button click immediately
    await ctx.answerCbQuery('Saving transaction...');

    // Save transaction via Actual API
    await addTransaction(defaultAccountId, categoryId, amountInCents);

    // Clear session state
    ctx.session.amountInCents = undefined;

    const displayAmount = (Math.abs(amountInCents) / 100).toFixed(2);
    
    // Edit the original message to show success
    await ctx.editMessageText(`✅ Transaction of ${displayAmount} saved successfully!`);
    
  } catch (error) {
    console.error('Error adding transaction:', error);
    await ctx.reply('Failed to save the transaction.');
  }
});

// Initialize Actual Budget and start bot
async function start() {
  try {
    await initActual();
    
    console.log('Starting Telegram bot...');
    bot.launch();

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

start();
