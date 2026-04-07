const PROMPT = `Sen bir muhasebe uzmanısın ve bu bir RESMİ FATURA / FİŞ. Aynı fatura sana hem PDF (document) hem de yüksek çözünürlüklü görsel olarak verildi; ikisini çapraz doğrulayarak oku. Hata kabul edilmez, çünkü bu veri muhasebeye girecek.

ÇIKTI: SADECE geçerli JSON. Açıklama, markdown, code fence YOK. JSON dışında hiçbir karakter olmasın.

MUTLAK KURALLAR — UYDURMA YASAK:
A. SADECE fiş üzerinde BİRE BİR GÖRDÜĞÜN sayıları yaz. Bir sayıdan emin değilsen, o alanı null veya 0 bırak — ASLA tahmin etme, yuvarlama, hesaplayarak türetme.
B. Barkod, stok kodu, fiş numarası gibi uzun rakam dizilerinden MİKTAR, FİYAT veya ADET TÜRETME. Barkod miktar değildir.
C. Fişte "25,50" yazıyorsa JSON'a 25.50 yaz; "*46,38" gibi başındaki * karakterini göz ardı et.
D. Görmediğin alanları uydurma: görünmüyorsa null ("" string değil null).

ADIM ADIM OKUMA:
1. Önce fişin üstündeki tedarikçi bilgisini oku (supplier, tel, adres).
2. Fatura numarasını (INVOICE No / FATURA No) ve tarihi oku. Tarihi GG.AA.YYYY formatına çevir. Örn: "02/04/2026" → "02.04.2026".
3. Kalemler bölümüne geç. Her ürün genelde şu yapıdadır:
   - Üst satır: barkod (uzun rakam)
   - Orta satır: ÜRÜN ADI    %KDV    TUTAR     (veya kilo fişinde: "0.585 KG x 79,29 TL/KG" gibi hesap satırı + alt satırda ürün adı ve TUTAR)
4. Her ürün için description = SADECE ürün adı (barkod, KDV yüzdesi, TUTAR YAZMA).
5. Eğer "0.585 KG x 79,29 TL/KG" gibi açık bir hesaplama satırı varsa: quantity=0.585, unit="kg", unit_price=79.29, line_total=TUTAR (aynı satırdaki sayı).
6. Eğer sadece ürün adı ve TUTAR varsa (adet belirtilmemiş): quantity=1, unit="adet", unit_price=TUTAR, line_total=TUTAR. ASLA başka sayı uydurma.
7. "***ÜRÜN İPTAL***", "İADE", "STORNO" yazısı olan satır VE hemen altındaki/üstündeki eksi (-) tutarlı eşleşen satır — İKİSİNİ DE items'a EKLEME (iptal edilmiş olarak say).
8. ARA TOPLAM, TOPKDV, TOPLAM, GENEL TOPLAM, NAKİT, KART, PARA ÜSTÜ, KDV TUTARI satırları items'a EKLENMEZ.
9. total alanı = fişin en altındaki TOPLAM / GENEL TOPLAM satırındaki sayı. Doğrudan oku.
10. KDV: Fişte TOPKDV 0,00 yazıyorsa vat_rate=0. Her item için de kendi KDV oranını aynen al.
11. DOĞRULAMA: items listesindeki line_total'ların toplamı, üstteki total alanıyla ±0.02 içinde eşleşmelidir. Eşleşmiyorsa fişi baştan oku, atladığın/yanlış okuduğun satırı bul. Yine eşleşmiyorsa items'ı olduğu gibi bırak ama ASLA rastgele sayı ekleme.
12. Para birimi: fişte TL/TRY/₺ geçiyorsa "TRY". KKTC faturaları genelde TRY.

ŞEMA (alan adlarını aynen kullan):
{"supplier":"","supplier_phone":null,"supplier_address":null,"invoice_number":"","date":"GG.AA.YYYY","due_date":null,"currency":"TRY","subtotal":0,"vat_rate":0,"vat_amount":0,"total":0,"items":[{"description":"","quantity":1,"unit":"adet","unit_price":0,"vat_rate":0,"line_total":0}]}

ŞİMDİ FATURAYI OKU VE JSON'U YAZ. Tek karakter fazla yazma.`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { base64, mediaType, isPdf, pdfBase64, images } = req.body;
  if (!base64 && !images && !pdfBase64) return res.status(400).json({ error: "base64, pdfBase64 veya images gerekli" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key eksik" });

  const contentBlocks = [];
  // 1) PDF document (native) — en iyi kalite
  if (pdfBase64) {
    contentBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } });
  } else if (isPdf && base64) {
    contentBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } });
  }
  // 2) Yüksek DPI rasterize edilmiş görseller — çapraz doğrulama için
  if (Array.isArray(images) && images.length) {
    for (const img of images) {
      contentBlocks.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType || "image/jpeg", data: img.data }
      });
    }
  }
  // 3) Tek görsel durumu
  if (!contentBlocks.length && base64 && !isPdf) {
    contentBlocks.push({ type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: base64 } });
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: 8000,
      messages: [{
        role: "user",
        content: [
          ...contentBlocks,
          { type: "text", text: PROMPT }
        ]
      }]
    })
  });

  const data = await response.json();
  return res.status(response.ok ? 200 : 500).json(data);
}
