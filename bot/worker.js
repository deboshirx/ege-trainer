// Telegram-бот «Тренажёр ЕГЭ» для Cloudflare Workers — доступ по заявкам.
//
// Как работает:
//  • ученик жмёт /start → ему: «Заявка отправлена», администратору: уведомление с кнопками
//    «✅ Открыть доступ» / «❌ Отказать»;
//  • после одобрения ученик получает кнопку, которая открывает мини-апп;
//  • мини-апп при запуске спрашивает у воркера (адрес /check), открыт ли доступ этому пользователю.
//
// Настройки воркера (Settings → Variables and Secrets):
//  • BOT_TOKEN      — токен бота (секрет);
//  • ADMIN_IDS      — Telegram ID администраторов через запятую (узнать свой: отправить боту /myid);
//  • WEBHOOK_SECRET — любая строка из латинских букв и цифр, та же, что в setWebhook (секрет).
// Привязка хранилища (Settings → Bindings): KV namespace с именем переменной ACCESS.
//
// Команды администратора: /myid, /pending (заявки в ожидании), /revoke ID (закрыть доступ).
// Подключить вебхук: открыть https://<адрес воркера>/setup?key=<WEBHOOK_SECRET>.

const APP_URL = "https://deboshirx.github.io/ege-trainer/";
const APP_ORIGIN = "https://deboshirx.github.io";

const TEXT = {
  welcome:
    "Доступ открыт! 🎉\n\n" +
    "Это тренажёр ЕГЭ:\n" +
    "• задания по всем номерам экзамена\n" +
    "• проверка ответа и подробные решения\n" +
    "• объяснения, как решать каждый номер\n" +
    "• помощь кураторов, если что-то непонятно\n\n" +
    "Жми кнопку ниже, выбирай свои предметы и начинай тренировку 👇",
  sent: "Привет! 👋\n\nТвоя заявка на доступ к тренажёру ЕГЭ отправлена на рассмотрение. Ожидай ответа — бот пришлёт сообщение, как только доступ откроют.",
  pending: "Заявка уже на рассмотрении ⏳ Как только доступ откроют, бот пришлёт сообщение.",
  rejected: "К сожалению, доступ к тренажёру пока не открыт. Если это ошибка — свяжись с нами.",
  hint: "Тренажёр открывается кнопкой ниже 👇",
  start: "Чтобы отправить заявку на доступ, нажми /start",
  revoked: "Доступ к тренажёру закрыт администратором.",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Проверка доступа из мини-аппа
    if (url.pathname === "/check") return handleCheck(request, env);

    // Одноразовая настройка вебхука без ручного ввода токена:
    // откройте https://<адрес воркера>/setup?key=<WEBHOOK_SECRET>
    if (url.pathname === "/setup") {
      if (!env.WEBHOOK_SECRET || url.searchParams.get("key") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      const r = await tg(env, "setWebhook", { url: url.origin + "/", secret_token: env.WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"] });
      return new Response(r ? await r.text() : "BOT_TOKEN не задан", { headers: { "Content-Type": "application/json; charset=utf-8" } });
    }

    // Проверка, что воркер жив
    if (request.method !== "POST") return new Response("Бот работает ✅");

    // Запросы от Telegram должны содержать секрет, заданный в setWebhook
    if (!env.WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }

    let update;
    try { update = await request.json(); } catch (e) { return new Response("ok"); }

    try {
      if (update.callback_query) await onCallback(update.callback_query, env);
      else if (update.message) await onMessage(update.message, env);
    } catch (e) {
      console.log("error", e && e.stack || e);
    }
    // Telegram ждёт ответ 200, иначе будет присылать обновление повторно
    return new Response("ok");
  },
};

/* ---------------- Сообщения ---------------- */

async function onMessage(msg, env) {
  if (!msg.from || msg.chat.type !== "private") return;
  const uid = msg.from.id;
  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  const admin = isAdmin(uid, env);

  if (text === "/myid") return send(env, uid, "Твой Telegram ID: " + uid);

  if (admin && text === "/pending") return listPending(env, uid);
  if (admin && text.startsWith("/revoke")) {
    const id = text.split(/\s+/)[1];
    if (!/^\d+$/.test(id || "")) return send(env, uid, "Использование: /revoke 123456789");
    await setUser(env, id, { status: "rejected" });
    await send(env, id, TEXT.revoked);
    return send(env, uid, "Доступ для " + id + " закрыт.");
  }

  if (admin) return send(env, uid, "Ты администратор — доступ открыт.\nКоманды: /pending, /revoke ID, /myid", appButton());

  const user = await getUser(env, uid);
  const status = user && user.status;

  if (status === "approved") return send(env, uid, text.startsWith("/start") ? TEXT.welcome : TEXT.hint, appButton());
  if (status === "pending") return send(env, uid, TEXT.pending);
  if (status === "rejected") return send(env, uid, TEXT.rejected);

  // Новый пользователь: заявка отправляется на любой первый контакт с ботом
  const info = { status: "pending", name: fullName(msg.from), username: msg.from.username || "", at: Date.now() };
  await setUser(env, uid, info);
  await send(env, uid, TEXT.sent);
  await notifyAdmins(env, uid, info);
}

async function notifyAdmins(env, uid, info) {
  const who = escapeHtml(info.name) + (info.username ? " (@" + escapeHtml(info.username) + ")" : "");
  const text = "🆕 <b>Новая заявка на доступ</b>\n\n" + who + "\nID: <code>" + uid + "</code>";
  const keyboard = { inline_keyboard: [[
    { text: "✅ Открыть доступ", callback_data: "ok:" + uid },
    { text: "❌ Отказать", callback_data: "no:" + uid },
  ]] };
  for (const admin of adminIds(env)) {
    await tg(env, "sendMessage", { chat_id: admin, text, parse_mode: "HTML", reply_markup: keyboard });
  }
}

async function listPending(env, adminId) {
  if (!env.ACCESS) return send(env, adminId, "Хранилище ACCESS не подключено.");
  const list = await env.ACCESS.list({ prefix: "user:" });
  let count = 0;
  for (const k of list.keys) {
    const u = await env.ACCESS.get(k.name, "json");
    if (u && u.status === "pending") { count++; await notifyAdmins(env, k.name.slice(5), u); }
  }
  if (!count) await send(env, adminId, "Новых заявок нет.");
}

/* ---------------- Кнопки администратора ---------------- */

async function onCallback(cq, env) {
  const data = cq.data || "";
  const m = data.match(/^(ok|no):(\d+)$/);
  if (!m || !isAdmin(cq.from.id, env)) {
    return tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Недостаточно прав" });
  }
  const [, action, uid] = m;
  const user = (await getUser(env, uid)) || {};
  const approved = action === "ok";
  await setUser(env, uid, { ...user, status: approved ? "approved" : "rejected", by: cq.from.id, decidedAt: Date.now() });

  if (approved) await send(env, uid, TEXT.welcome, appButton());
  else await send(env, uid, TEXT.rejected);

  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: approved ? "Доступ открыт" : "Заявка отклонена" });
  if (cq.message) {
    const who = escapeHtml(user.name || "Пользователь") + (user.username ? " (@" + escapeHtml(user.username) + ")" : "");
    await tg(env, "editMessageText", {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      parse_mode: "HTML",
      text: (approved ? "✅ <b>Доступ открыт</b>" : "❌ <b>Заявка отклонена</b>") + "\n\n" + who + "\nID: <code>" + uid + "</code>",
    });
  }
}

/* ---------------- Проверка доступа из мини-аппа ---------------- */

async function handleCheck(request, env) {
  const cors = {
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return new Response(JSON.stringify({ ok: false }), { status: 405, headers: cors });

  let body;
  try { body = await request.json(); } catch (e) { body = {}; }
  const tgUser = await verifyInitData(body.initData || "", env.BOT_TOKEN);
  if (!tgUser) return new Response(JSON.stringify({ ok: false, status: "invalid" }), { headers: cors });

  if (isAdmin(tgUser.id, env)) return new Response(JSON.stringify({ ok: true, status: "admin" }), { headers: cors });
  const user = await getUser(env, tgUser.id);
  const status = (user && user.status) || "none";
  return new Response(JSON.stringify({ ok: status === "approved", status }), { headers: cors });
}

// Проверка подписи данных Telegram WebApp (initData)
async function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join("\n");
  const enc = new TextEncoder();
  const secretKey = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", secretKey, enc.encode(botToken));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(dataCheck));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
  if (hex !== hash) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > 30 * 24 * 3600) return null;
  try { return JSON.parse(params.get("user") || "null"); } catch (e) { return null; }
}

/* ---------------- Хранилище и утилиты ---------------- */

async function getUser(env, uid) {
  if (!env.ACCESS) return null;
  return env.ACCESS.get("user:" + uid, "json");
}
async function setUser(env, uid, data) {
  if (!env.ACCESS) return;
  await env.ACCESS.put("user:" + uid, JSON.stringify(data));
}
function adminIds(env) {
  return String(env.ADMIN_IDS || "").split(/[,\s]+/).filter(Boolean);
}
function isAdmin(uid, env) {
  return adminIds(env).includes(String(uid));
}
function fullName(u) {
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || "Без имени";
}
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function appButton() {
  return { inline_keyboard: [[{ text: "📚 Открыть тренажёр", web_app: { url: APP_URL } }]] };
}
function send(env, chatId, text, replyMarkup) {
  const body = { chat_id: chatId, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return tg(env, "sendMessage", body);
}
async function tg(env, method, body) {
  if (!env.BOT_TOKEN) return;
  const r = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.log(method, r.status, await r.clone().text());
  return r;
}
