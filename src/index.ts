import { Telegraf, session, Context } from 'telegraf';
import { loadConfig } from './config';
import { initActual, getCategories, getAccounts, addTransaction, finalize } from './actual';
import { processScreenshot, countAmountsInOcr, extractTextFromImage, downloadTelegramPhoto, buildAnalysisPrompt, callAiProvider, parseAiResponse, type OcrAnalysis } from './ocr';
import { loadRules, saveRule, deleteRule, matchRule, type Rule } from './rules';
import { unlink } from 'node:fs/promises';

// --- Types ---

interface SessionData {
  amountInCents?: number;
  accountId?: string;
  ocrPending?: {
    amountInCents: number;
    categoryId: string;
    categoryName: string;
    ocrText: string;
  };
}

interface BotContext extends Context {
  session?: SessionData;
}

// --- Load config (validates all env vars at startup) ---

const config = loadConfig();

// --- Bot setup ---

const bot = new Telegraf<BotContext>(config.telegramBotToken);

// In-memory session for FSM state (amount -> [account ->] category selection)
bot.use(session());

/**
 * Creates middleware that restricts bot access to approved Telegram users.
 *
 * @param allowedUserIds - Telegram user IDs permitted to continue processing.
 * @returns Middleware that continues for approved users; when the list is empty, replies with a configuration warning and blocks processing.
 */
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

  // OCR flow: if user is editing amount after screenshot, handle here
  if (ctx.session?.ocrPending && !ctx.session?.amountInCents) {
    const newAmount = parseAmountToCents(text);
    if (newAmount === null) {
      return ctx.reply('Please send a valid amount (e.g., 15.50).');
    }
    ctx.session.ocrPending.amountInCents = newAmount;
    const updatedAnalysis: OcrAnalysis = {
      amountInCents: newAmount,
      categoryId: ctx.session.ocrPending.categoryId,
      categoryName: ctx.session.ocrPending.categoryName,
      confidence: 'medium',
      reasoning: 'Amount manually adjusted',
    };
    await sendOcrSuggestion(ctx, updatedAnalysis, ctx.session.ocrPending.ocrText);
    return;
  }

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

// --- OCR Screenshot Processing ---

// Helper: show OCR suggestion for confirmation
async function sendOcrSuggestion(ctx: BotContext, analysis: OcrAnalysis, ocrText: string, amountOverride?: number): Promise<void> {
  const amountCents = amountOverride ?? analysis.amountInCents;
  const displayAmount = amountCents !== null
    ? (Math.abs(amountCents) / 100).toFixed(2)
    : '???';

  const categoryDisplay = analysis.categoryName ?? 'No match found';
  const confidenceLabel = analysis.confidence === 'high' ? '(high confidence)' :
    analysis.confidence === 'medium' ? '(medium confidence)' :
    '(low confidence)';

  const ocrPreview = ocrText.length > 200 ? ocrText.slice(0, 200) + '...' : ocrText;

  // Check for multiple amounts in OCR
  const amountCount = countAmountsInOcr(ocrText);
  const multiAmountWarning = amountCount > 1
    ? '\n⚠️ Multiple amounts detected — please verify'
    : '';

  const lines = [
    `Screenshot Analysis ${confidenceLabel}`,
    '',
    `Amount: ${displayAmount}${multiAmountWarning}`,
    `Category: ${categoryDisplay}`,
    analysis.reasoning ? `Note: ${analysis.reasoning}` : '',
    '',
    'OCR text:',
    '```',
    ocrPreview || '(no text detected)',
    '```',
  ];

  const buttons: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: 'Confirm', callback_data: 'ocr_confirm' }],
    [
      { text: 'Edit Amount', callback_data: 'ocr_edit_amount' },
      { text: 'Change Category', callback_data: 'ocr_change_cat' },
    ],
    [{ text: 'Cancel', callback_data: 'ocr_cancel' }],
    [{ text: 'Create rule for this merchant', callback_data: 'ocr_create_rule' }],
  ];

  await ctx.reply(lines.filter(Boolean).join('\n'), {
    reply_markup: { inline_keyboard: buttons },
  });
}

// Photo handler — process screenshot
bot.on('photo', async (ctx) => {
  if (!config.aiProvider) {
    return; // Feature not configured — fall through silently
  }

  try {
    await ctx.reply('Processing screenshot...');

    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.telegram.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

    // Check for caption amount override
    const caption = ctx.message.caption;
    let captionAmount: number | null = null;
    if (caption) {
      captionAmount = parseAmountToCents(caption);
    }

    // Check local rules first (before AI)
    // We need OCR text for rule matching, so run OCR first
    const ocrConfig = loadConfig();

    // Download and OCR the image
    const tmpPath = await downloadTelegramPhoto(config.telegramBotToken, fileUrl);
    let ocrText = '';
    try {
      ocrText = await extractTextFromImage(tmpPath, ocrConfig.ocrLanguage);
    } finally {
      await unlink(tmpPath).catch(() => {});
    }

    // Check rules
    const matchedRule = matchRule(ocrText);

    let analysis: OcrAnalysis;

    if (matchedRule && captionAmount !== null) {
      // Rule matched + caption override: use both
      console.log(`[OCR] Rule matched with caption: ${matchedRule.pattern} -> ${matchedRule.categoryName} (${matchedRule.categoryId})`);
      analysis = {
        amountInCents: captionAmount,
        categoryId: matchedRule.categoryId,
        categoryName: matchedRule.categoryName,
        confidence: 'high',
        reasoning: `Rule matched: ${matchedRule.pattern}`,
      };
    } else if (matchedRule) {
      // Rule matched, no caption: use OCR for amount, rule for category
      console.log(`[OCR] Rule matched: ${matchedRule.pattern} -> ${matchedRule.categoryName} (${matchedRule.categoryId})`);
      const categories = await getCategories();
      const prompt = buildAnalysisPrompt(ocrText, categories);
      const rawResponse = await callAiProvider(prompt);
      const aiResult = parseAiResponse(rawResponse);
      analysis = {
        ...aiResult,
        categoryId: matchedRule.categoryId,
        categoryName: matchedRule.categoryName,
        reasoning: `Rule matched: ${matchedRule.pattern}. ${aiResult.reasoning}`,
      };
    } else {
      // No rule: full AI pipeline
      console.log('[OCR] No rule matched, running full AI pipeline');
      analysis = await processScreenshot(config.telegramBotToken, fileUrl, ocrText);
      console.log(`[OCR] AI result: categoryId=${analysis.categoryId}, categoryName=${analysis.categoryName}, amount=${analysis.amountInCents}`);
    }

    ctx.session ??= {};

    const finalAmount = captionAmount ?? analysis.amountInCents;

    if (finalAmount !== null && analysis.categoryId !== null) {
      // Full match — store for confirmation
      ctx.session.ocrPending = {
        amountInCents: finalAmount,
        categoryId: analysis.categoryId,
        categoryName: analysis.categoryName ?? '',
        ocrText: ocrText,
      };
      console.log(`[OCR] Stored ocrPending: categoryId=${analysis.categoryId}, categoryName=${analysis.categoryName}`);

      if (config.accounts.length === 1) {
        ctx.session.accountId = config.accounts[0].id;
        await sendOcrSuggestion(ctx, analysis, ocrText, captionAmount ?? undefined);
      } else {
        // Multiple accounts: show account selection first
        const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
        let row: Array<{ text: string; callback_data: string }> = [];
        for (const account of config.accounts) {
          row.push({ text: account.name, callback_data: `acc_ocr_${account.id}` });
          if (row.length === 2) {
            buttons.push(row);
            row = [];
          }
        }
        if (row.length > 0) buttons.push(row);

        const displayAmount = (Math.abs(finalAmount) / 100).toFixed(2);
        await ctx.reply(`Amount: ${displayAmount}\nCategory: ${analysis.categoryName}\nPlease select an account:`, {
          reply_markup: { inline_keyboard: buttons },
        });
      }
    } else if (finalAmount !== null) {
      // Amount found but no category match — show full OCR suggestion with edit buttons
      ctx.session.ocrPending = {
        amountInCents: finalAmount,
        categoryId: '',
        categoryName: '',
        ocrText: ocrText,
      };

      if (config.accounts.length === 1) {
        ctx.session.accountId = config.accounts[0].id;
        await sendOcrSuggestion(ctx, {
          amountInCents: finalAmount,
          categoryId: null,
          categoryName: null,
          confidence: 'low',
          reasoning: analysis.reasoning,
        }, ocrText);
      } else {
        // Multiple accounts: show account selection first, then sendOcrSuggestion via acc_ocr_ handler
        const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
        let row: Array<{ text: string; callback_data: string }> = [];
        for (const account of config.accounts) {
          row.push({ text: account.name, callback_data: `acc_ocr_${account.id}` });
          if (row.length === 2) {
            buttons.push(row);
            row = [];
          }
        }
        if (row.length > 0) buttons.push(row);

        const displayAmount = (Math.abs(finalAmount) / 100).toFixed(2);
        await ctx.reply(`Amount: ${displayAmount}\nCategory: not detected\nPlease select an account:`, {
          reply_markup: { inline_keyboard: buttons },
        });
      }
    } else {
      await ctx.reply('Could not extract useful data from the screenshot. Please send the amount manually.');
    }
  } catch (error) {
    console.error('Error processing screenshot:', error);
    await ctx.reply('Failed to process the screenshot. Please try again or send the amount manually.');
  }
});

// OCR Account selection (when multiple accounts configured)
bot.action(/^acc_ocr_(.+)$/, async (ctx) => {
  const accountId = ctx.match[1];
  const ocrPending = ctx.session?.ocrPending;

  if (!ocrPending) {
    await ctx.answerCbQuery('Session expired. Please send a new screenshot.', { show_alert: true });
    return;
  }

  if (ctx.session) {
    ctx.session.accountId = accountId;
  }

  await ctx.answerCbQuery();
  await sendOcrSuggestion(ctx, {
    amountInCents: ocrPending.amountInCents,
    categoryId: ocrPending.categoryId,
    categoryName: ocrPending.categoryName,
    confidence: 'high',
    reasoning: ocrPending.ocrText,
  }, ocrPending.ocrText);
});

// OCR Confirmation: Confirm
bot.action('ocr_confirm', async (ctx) => {
  const ocrPending = ctx.session?.ocrPending;
  if (!ocrPending) {
    await ctx.answerCbQuery('Session expired. Please send a new screenshot.', { show_alert: true });
    return;
  }

  try {
    if (!ocrPending.categoryId) {
      await ctx.answerCbQuery('Please select a category first.', { show_alert: true });
      return;
    }

    await ctx.answerCbQuery('Saving transaction...');

    const accountId = ctx.session?.accountId ?? config.accounts[0]?.id;
    if (!accountId) {
      await ctx.reply('No account configured. Please check ACTUAL_ACCOUNTS.');
      return;
    }

    console.log(`[OCR CONFIRM] Saving transaction: categoryId=${ocrPending.categoryId}, categoryName=${ocrPending.categoryName}, amount=${ocrPending.amountInCents}`);
    await addTransaction(accountId, ocrPending.categoryId, ocrPending.amountInCents, config.actualPayeeName);

    if (ctx.session) {
      ctx.session.ocrPending = undefined;
      ctx.session.amountInCents = undefined;
      ctx.session.accountId = undefined;
    }

    const displayAmount = (Math.abs(ocrPending.amountInCents) / 100).toFixed(2);
    await ctx.editMessageText(`Transaction of ${displayAmount} (${ocrPending.categoryName}) saved successfully!`);
  } catch (error) {
    console.error('Error saving OCR transaction:', error);
    await ctx.reply('Failed to save the transaction.');
  }
});

// OCR Confirmation: Edit Amount
bot.action('ocr_edit_amount', async (ctx) => {
  const ocrPending = ctx.session?.ocrPending;
  if (!ocrPending) {
    await ctx.answerCbQuery('Session expired.', { show_alert: true });
    return;
  }

  await ctx.answerCbQuery();
  await ctx.reply('Please send the correct amount (e.g., 15.50):');
  // Clear amountInCents so text handler knows we're in OCR-edit mode
  if (ctx.session) {
    ctx.session.amountInCents = undefined;
  }
});

// OCR Confirmation: Change Category
bot.action('ocr_change_cat', async (ctx) => {
  const ocrPending = ctx.session?.ocrPending;
  if (!ocrPending) {
    await ctx.answerCbQuery('Session expired.', { show_alert: true });
    return;
  }

  await ctx.answerCbQuery();

  if (ctx.session) {
    ctx.session.amountInCents = ocrPending.amountInCents;
  }
  if (config.accounts.length === 1 && ctx.session) {
    ctx.session.accountId = config.accounts[0].id;
  }
  await sendCategorySelection(ctx, ocrPending.amountInCents);
});

// OCR Confirmation: Cancel
bot.action('ocr_cancel', async (ctx) => {
  if (ctx.session) {
    ctx.session.ocrPending = undefined;
    ctx.session.amountInCents = undefined;
    ctx.session.accountId = undefined;
  }

  await ctx.answerCbQuery();
  await ctx.editMessageText('Screenshot processing cancelled.');
});

// OCR Confirmation: Create Rule
bot.action('ocr_create_rule', async (ctx) => {
  const ocrPending = ctx.session?.ocrPending;
  if (!ocrPending) {
    await ctx.answerCbQuery('Session expired.', { show_alert: true });
    return;
  }

  await ctx.answerCbQuery();

  // Extract a pattern from the OCR text (first meaningful word/phrase)
  const pattern = ocrPending.ocrText.split(/\s+/).slice(0, 3).join(' ').toUpperCase() || 'UNKNOWN';

  saveRule(pattern, ocrPending.categoryId, ocrPending.categoryName);

  await ctx.reply(`Rule created: "${pattern}" → ${ocrPending.categoryName}\nFuture screenshots matching this pattern will be auto-categorized.`);
});

// /rules command — list and manage saved rules
bot.command('rules', async (ctx) => {
  const rules = loadRules();

  if (rules.length === 0) {
    await ctx.reply('No rules saved yet. Send a screenshot to create one.');
    return;
  }

  const lines = rules.map((r, i) => `${i + 1}. ${r.pattern} → ${r.categoryName}`);
  const buttons = rules.map((r) => [
    { text: `Delete: ${r.pattern}`, callback_data: `rule_delete_${r.id}` },
  ]);

  await ctx.reply(`Saved rules:\n\n${lines.join('\n')}`, {
    reply_markup: { inline_keyboard: buttons },
  });
});

// Rule deletion
bot.action(/^rule_delete_(.+)$/, async (ctx) => {
  const ruleId = ctx.match[1];
  const rules = loadRules();
  const rule = rules.find((r) => r.id === ruleId);

  if (!rule) {
    await ctx.answerCbQuery('Rule not found.', { show_alert: true });
    return;
  }

  deleteRule(ruleId);
  await ctx.answerCbQuery();
  await ctx.editMessageText(`Rule deleted: ${rule.pattern} → ${rule.categoryName}`);
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

/**
 * Initializes the Actual API, starts the Telegram bot, and handles graceful shutdown signals.
 */

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
