const { Telegraf } = require('telegraf');
const bot = new Telegraf('dummy');
console.log('launching');
const p = bot.launch();
console.log('after launch');
