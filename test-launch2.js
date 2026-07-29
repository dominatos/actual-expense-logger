const { Telegraf } = require('telegraf');
async function run() {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || 'dummy');
  // mock callApi to avoid 404
  bot.telegram.callApi = async () => true;
  console.log('launching');
  await bot.launch();
  console.log('after launch');
  process.exit(0);
}
run();
