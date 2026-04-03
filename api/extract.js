const PROMPT = `Bu görüntüdeki faturayı analiz et. SADECE JSON yaz, başka hiçbir şey ekleme:
{"supplier":"","supplier_phone":"telefon numarası veya null","supplier_address":"adres veya null","invoice_number":"","date":"GG.AA.YYYY","due_date":"GG.AA.YYYY veya null","currency":"TRY","subtotal":0,"vat_rate":18,"vat_amount":0,"total":0,"items":[{"description":"","quantity":1,"unit":"adet","unit_price":0,"vat_rate":18,"line_total":0}]}`;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { base64, mediaType } = req.body;
  if (!base64) return res.status(400).json({ error: "base64 gerekli" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key eksik" });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: base64 } },
          { type: "text", text: PROMPT }
        ]
      }]
    })
  });

  const data = await response.json();
  return res.status(response.ok ? 200 : 500).json(data);
}
