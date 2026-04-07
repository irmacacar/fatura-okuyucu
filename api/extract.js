const PROMPT = `Sen bir muhasebe uzmanısın ve bu bir RESMİ FATURA / FİŞ. Görseli aşırı dikkatli oku ve çıkarımı eksiksiz yap. Hata kabul edilmez.

ÇIKTI: SADECE geçerli JSON. Açıklama, markdown, code fence YOK.

OKUMA KURALLARI:
1. Fişin/faturanın TÜM satırlarını yukarıdan aşağıya, hiçbirini atlamadan oku. Aynı isimli ürün birden fazla geçiyorsa hepsini AYRI item olarak ekle.
2. Termal fişlerde satırlar bazen "ÜRÜN ADI ... %KDV ... TUTAR" şeklinde tek satırdadır; bazen ürün adı bir satırda, miktar/fiyat/tutar bir alt satırdadır. İkisini birleştirip tek bir item üret.
3. Bir kalemin description'ı SADECE ürün adı olmalı. Barkod (uzun rakam dizisi), stok kodu, KDV oranı veya tutar description'a YAZILMAZ.
4. quantity boş ise 1 kabul et. unit görünmüyorsa "adet" yaz (kg, lt, gr açıkça yazıyorsa onu kullan).
5. unit_price × quantity = line_total olmalı. Tutarsızlık varsa fişteki TUTAR sütununu line_total kabul et, unit_price'ı ona göre düzelt.
6. Eksi (-) işaretli satırlar, "İPTAL" / "İADE" / "STORNO" yazan satırlar items listesine GİRMEZ.
7. ARA TOPLAM, KDV, GENEL TOPLAM, TOPKDV, NAKİT, KART, PARA ÜSTÜ gibi özet/ödeme satırları items listesine GİRMEZ.
8. KDV oranını faturadan oku. Fişte birden fazla KDV oranı varsa her item'ın kendi vat_rate'i olmalı; üst seviyedeki vat_rate ağırlıklı ortalama veya en yaygın oran olabilir.
9. total ALANINI fişin EN ALTINDAKİ "GENEL TOPLAM" / "TOPLAM" / "TUTAR" değerinden al. items'ın toplamı bu değerle uyuşmalı; uyuşmuyorsa satırları tekrar gözden geçir.
10. Tarih GG.AA.YYYY formatında olmalı. Fişte "02/07/14" gibi yazıyorsa "02.07.2014" yap.
11. Tutarlar virgüllü Türkçe formatta olabilir ("2,99"). JSON'a number olarak yaz: 2.99
12. Tedarikçi adı (supplier) fişin EN ÜSTÜNDEKİ firma adıdır. Adres ve telefon varsa doldur, yoksa null.
13. Hiçbir alanı uydurma. Görmediğin değer için null veya boş string ("") kullan.

ŞEMA (alanları aynen kullan):
{"supplier":"","supplier_phone":null,"supplier_address":null,"invoice_number":"","date":"GG.AA.YYYY","due_date":null,"currency":"TRY","subtotal":0,"vat_rate":0,"vat_amount":0,"total":0,"items":[{"description":"","quantity":1,"unit":"adet","unit_price":0,"vat_rate":0,"line_total":0}]}

ŞİMDİ FATURAYI OKU VE JSON'U YAZ.`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { base64, mediaType, isPdf, images } = req.body;
  if (!base64 && !images) return res.status(400).json({ error: "base64 veya images gerekli" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key eksik" });

  let contentBlocks;
  if (Array.isArray(images) && images.length) {
    // Çoklu sayfa görseli (PDF -> client-side render)
    contentBlocks = images.map(img => ({
      type: "image",
      source: { type: "base64", media_type: img.mediaType || "image/jpeg", data: img.data }
    }));
  } else if (isPdf) {
    contentBlocks = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }];
  } else {
    contentBlocks = [{ type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: base64 } }];
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
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
