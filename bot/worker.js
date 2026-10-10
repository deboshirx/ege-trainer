// Telegram-бот «Тренажёр ЕГЭ» для Cloudflare Workers.
// На /start (и любое другое сообщение) присылает кнопку, которая открывает мини-апп.
// Токен бота НЕ хранится в коде: его нужно добавить в настройках воркера
// как секрет с именем BOT_TOKEN.

const APP_URL = "https://deboshirx.github.io/ege-trainer/";

const WELCOME =
  "Привет! 👋\n\n" +
  "Это тренажёр ЕГЭ:\n" +
  "• задания по всем номерам экзамена\n" +
  "• проверка ответа и подробные решения\n" +
  "• объяснения, как решать каждый номер\n" +
  "• помощь кураторов, если что-то непонятно\n\n" +
  "Жми кнопку ниже, выбирай свои предметы и начинай тренировку 👇";

const HINT = "Тренажёр открывается кнопкой ниже 👇";

export default {
  async fetch(request, env) {
    // Проверка, что воркер жив: откройте его адрес в браузере.
    if (request.method !== "POST") {
      return new Response("Бот работает ✅");
    }

    let update;
    try {
      update = await request.json();
    } catch (e) {
      return new Response("ok");
    }

    const msg = update.message;
    if (msg && msg.chat) {
      const isStart = typeof msg.text === "string" && msg.text.startsWith("/start");
      await sendMessage(env.BOT_TOKEN, msg.chat.id, isStart ? WELCOME : HINT);
    }

    // Telegram ждёт ответ 200, иначе будет присылать сообщение повторно.
    return new Response("ok");
  },
};

async function sendMessage(token, chatId, text) {
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [[{ text: "📚 Открыть тренажёр", web_app: { url: APP_URL } }]],
      },
    }),
  });
}
