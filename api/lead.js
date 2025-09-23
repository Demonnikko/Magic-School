// /api/lead.js — серверный роут Vercel/Next
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { parent = "", phone = "", age = "", email = "" } = req.body || {};

    // простая валидация на сервере
    if (!parent || !phone) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      return res.status(500).json({ ok: false, error: "Missing env vars" });
    }

    const text =
`🪄 Заявка на пробный урок
Имя родителя: ${parent}
Телефон: ${phone}
Возраст ребёнка: ${age || "-"}
Email: ${email || "-"}`;

    const tgUrl = `https://api.telegram.org/bot${token}/sendMessage`;

    const tgResp = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!tgResp.ok) {
      const err = await tgResp.text();
      return res.status(502).json({ ok: false, error: `Telegram error: ${err}` });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
