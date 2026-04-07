#!/usr/bin/env node
// Lokal extract testi.
// Kullanım:
//   ANTHROPIC_API_KEY=sk-... node scripts/test-extract.js "/path/to/fatura.pdf"
//
// PDF için pdfjs-dist ile sayfaları yüksek DPI'da JPEG'e render edip
// uygulamayla AYNI prompt + AYNI model ile Anthropic'e gönderir.

import { readFile } from 'node:fs/promises'
import { extname, basename } from 'node:path'
import { createCanvas } from 'canvas'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

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

ŞİMDİ FATURAYI OKU VE JSON'U YAZ.`

const MODEL = 'claude-sonnet-4-5'
const MAX_TOKENS = 8000

async function pdfPagesToJpegBase64(filePath, scale = 2.5) {
  const data = new Uint8Array(await readFile(filePath))
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise
  const out = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(viewport.width, viewport.height)
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport, canvasFactory: undefined }).promise
    const buf = canvas.toBuffer('image/jpeg', { quality: 0.92 })
    out.push(buf.toString('base64'))
  }
  return out
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Kullanım: node scripts/test-extract.js <pdf-veya-image-path>')
    process.exit(1)
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY ortam değişkeni gerekli')
    process.exit(1)
  }
  const ext = extname(file).toLowerCase()
  let content
  if (ext === '.pdf') {
    console.log(`PDF render ediliyor: ${basename(file)} ...`)
    const pages = await pdfPagesToJpegBase64(file)
    console.log(`  ${pages.length} sayfa render edildi`)
    content = pages.map(d => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: d }
    }))
  } else {
    const buf = await readFile(file)
    const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg'
    content = [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') } }]
  }

  console.log(`Anthropic API çağrılıyor (model=${MODEL}, max_tokens=${MAX_TOKENS}) ...`)
  const t0 = Date.now()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: [...content, { type: 'text', text: PROMPT }] }]
    })
  })
  const raw = await res.text()
  const dt = ((Date.now() - t0) / 1000).toFixed(1)
  let data
  try { data = JSON.parse(raw) } catch {
    console.error(`HTTP ${res.status} (non-JSON):`)
    console.error(raw.slice(0, 500))
    process.exit(1)
  }
  if (!res.ok) {
    console.error('API HATASI:', JSON.stringify(data, null, 2))
    process.exit(1)
  }
  console.log(`Yanıt ${dt}s, stop_reason=${data.stop_reason}, usage=${JSON.stringify(data.usage)}`)
  const txt = (data.content || []).find(b => b.type === 'text')?.text || ''
  const cleaned = txt.replace(/```json|```/g, '').trim()
  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    console.error('JSON parse başarısız. Ham yanıt:')
    console.error(txt)
    process.exit(1)
  }
  console.log('\n=== ÇIKARILAN VERİ ===')
  console.log(JSON.stringify(parsed, null, 2))
  const itemsTotal = (parsed.items || []).reduce((a, it) => a + (Number(it.line_total) || 0), 0)
  console.log(`\nÖZET:`)
  console.log(`  supplier:    ${parsed.supplier}`)
  console.log(`  invoice_no:  ${parsed.invoice_number}`)
  console.log(`  date:        ${parsed.date}`)
  console.log(`  items:       ${(parsed.items || []).length}`)
  console.log(`  total:       ${parsed.total} ${parsed.currency || ''}`)
  console.log(`  items sum:   ${itemsTotal.toFixed(2)}`)
  if (Math.abs(itemsTotal - (Number(parsed.total) || 0)) > 0.05) {
    console.log(`  ⚠️  items toplamı ile total eşleşmiyor!`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
