/**
 * Wens AI - Cloudflare Worker backend
 * Required Cloudflare Secret: OPENAI_API_KEY
 * Optional variable: OPENAI_MODEL (default: gpt-4o-mini)
 */
const SYSTEM_PROMPT = `أنتِ ونس، رفيقة افتراضية مصرية ودودة وذكية. تحدثي باللهجة المصرية الطبيعية وبصيغة المؤنث عن نفسك. كوني دافئة ومحترمة وخفيفة الظل دون مبالغة أو ادعاء أنك إنسانة حقيقية. افهمي سياق المحادثة، واسألي سؤال متابعة واحدًا عند الحاجة. أجيبي بوضوح وباختصار مناسب. لا تدّعي أنك ترين صورة أو تسمعين صوتًا ما لم يتم إرسالها فعليًا. لا تطلبي كلمات مرور أو مفاتيح سرية أو بيانات دفع.`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/api/health")) {
      return json({
        ok: true,
        service: "wens-ai-backend",
        configured: Boolean(env.OPENAI_API_KEY)
      });
    }

    if (!["/chat", "/api/chat"].includes(url.pathname)) {
      return json({ error: "المسار غير موجود." }, 404);
    }

    if (request.method !== "POST") {
      return json({ error: "طريقة الطلب غير مدعومة." }, 405);
    }

    if (!env.OPENAI_API_KEY) {
      return json({ error: "مفتاح الذكاء الاصطناعي لم يُضف إلى إعدادات السيرفر بعد." }, 503);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "بيانات الطلب غير صالحة." }, 400);
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return json({ error: "اكتب رسالتك الأول." }, 400);
    if (message.length > 6000) return json({ error: "الرسالة طويلة جدًا؛ اختصرها قليلًا." }, 400);

    const history = Array.isArray(body.history) ? body.history.slice(-16) : [];
    const messages = [{ role: "system", content: SYSTEM_PROMPT }];

    for (const item of history) {
      if (!item || !["user", "assistant"].includes(item.role) ||
          typeof item.content !== "string") continue;
      messages.push({ role: item.role, content: item.content.slice(0, 6000) });
    }

    const last = history[history.length - 1];
    if (!last || last.role !== "user" || last.content !== message) {
      messages.push({ role: "user", content: message });
    }

    try {
      const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-4o-mini",
          messages,
          temperature: 0.7,
          max_tokens: 700
        })
      });

      const result = await upstream.json();
      if (!upstream.ok) {
        const detail = result?.error?.message || "حدث خطأ من خدمة الذكاء الاصطناعي.";
        return json({ error: detail }, upstream.status === 429 ? 429 : 502);
      }

      const answer = result?.choices?.[0]?.message?.content?.trim();
      if (!answer) return json({ error: "لم يصل رد نصي من الخدمة." }, 502);

      return json({ reply: answer });
    } catch {
      return json({ error: "تعذّر الاتصال بخدمة الذكاء الاصطناعي. حاول مرة أخرى." }, 502);
    }
  }
};
