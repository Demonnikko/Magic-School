// /api/lead.js — Vercel Serverless Function (CommonJS)

const RATE = { limit: 5, windowMs: 60_000 }; // 5 запросов в минуту с одного IP
const store = globalThis.__rateStore || (globalThis.__rateStore = new Map());

function rateLimited(ip) {
  const now = Date.now();
  const rec = store.get(ip) || { count: 0, start: now };
  if (now - rec.start > RATE.windowMs) {
    rec.count = 0;
    rec.start = now;
  }
  rec.count++;
  store.set(ip, rec);
  return rec.count > RATE.limit;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function sanitize(s, max = 200) {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function validPhone(v) {
  return /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/.test(v);
}

module.exports = async function handler(req, res) {
  // базовые заголовки
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  // запретим кросс-доменные POST (простейшая защита от CSRF)
  const origin = (req.headers.origin || "").toLowerCase();
  const host = (req.headers.host || "").toLowerCase();
  try {
    if (origin && new URL(origin).host !== host) {
      return res.status(403).end(JSON.stringify({ ok: false, error: "Forbidden origin" }));
    }
  } catch (_) {
    // если origin битый — тоже запрещаем
    return res.status(403).end(JSON.stringify({ ok: false, error: "Forbidden origin" }));
  }

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  if (rateLimited(ip)) {
    return res
      .status(429)
      .end(JSON.stringify({ ok: false, error: "Too many requests, try later" }));
  }

  try {
    const body = (req.body && typeof req.body === "object") ? req.body : await readJsonBody(req);

    // антибот: honeypot и минимальное время
    if (body.hp) {
      return res.status(400).end(JSON.stringify({ ok: false, error: "Bad request" }));
    }
    const ts = Number(body.ts || 0);
    if (!Number.isFinite(ts) || Date.now() - ts < 1500) {
      return res.status(400).end(JSON.stringify({ ok: false, error: "Too fast" }));
    }

    const parent = sanitize(body.parent, 80);
    const phone = sanitize(body.phone, 32);
    const age = sanitize(body.age, 8);
    const email = sanitize(body.email, 120);

    if (!parent || parent.length < 2) {
      return res.status(400).end(JSON.stringify({ ok: false, error: "Укажите имя" }));
    }
    if (!validPhone(phone)) {
      return res.status(400).end(JSON.stringify({ ok: false, error: "Телефон в формате +7 (XXX) XXX-XX-XX" }));
    }
    const ageNum = Number(age);
    if (!(ageNum >= 7 && ageNum <= 13)) {
      return res.status(400).end(JSON.stringify({ ok: false, error: "Возраст 7–13" }));
    }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).end(JSON.stringify({ ok: false, error: "Неверный email" }));
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      return res.status(500).end(JSON.stringify({ ok: false, error: "Missing server config" }));
    }

    const text =
`🪄 Заявка на пробный урок
Имя родителя: ${parent}
Телефон: ${phone}
Возраст ребёнка: ${ageNum}
Email: ${email || "-"}`;

    const tgUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    const tgResp = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!tgResp.ok) {
      const err = await tgResp.text();
      return res.status(502).end(JSON.stringify({ ok: false, error: `Telegram error: ${err}` }));
    }

    return res.status(200).end(JSON.stringify({ ok: true }));
  } catch (e) {
    return res
      .status(500)
      .end(JSON.stringify({ ok: false, error: e?.message || "Server error" }));
  }
};
