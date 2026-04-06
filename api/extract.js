const PROMPT = `Bu faturayı analiz et. SADECE JSON yaz, başka hiçbir şey ekleme.

ÖNEMLİ KURALLAR:
- Eksi (-) işaretli veya "İPTAL" yazılı kalemleri items listesine EKLEME
- Barkod numaralarını (uzun rakam dizileri) ürün adına EKLEME
- KDV oranını faturadan oku, varsayma - termal fişlerde genelde %0 veya %5'tir
- Miktar x birim fiyat = line_total olmalı, bunu kontrol et
- İndirim varsa subtotal'dan düş, toplama ekleme
- Faturadaki son genel toplamı total olarak kullan

{"supplier":"","supplier_phone":null,"supplier_address":null,"invoice_number":"","date":"GG.AA.YYYY","due_date":null,"currency":"TRY","subtotal":0,"vat_rate":0,"vat_amount":0,"total":0,"items":[{"description":"","quantity":1,"unit":"adet","unit_price":0,"vat_rate":0,"line_total":0}]}`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { base64, mediaType, isPdf } = req.body;
  if (!base64) return res.status(400).json({ error: "base64 gerekli" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key eksik" });

  const contentItem = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: base64 } };

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
          contentItem,
          { type: "text", text: PROMPT }
        ]
      }]
    })
  });

  const data = await response.json();
  return res.status(response.ok ? 200 : 500).json(data);
}