import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './supabase'
import Login from './Login'

const C = {
  bg:'#0f0f0f', surface:'#1a1a1a', surfaceAlt:'#212121',
  border:'#2a2a2a', accent:'#e8d5a3', accentDim:'#b5a47e',
  text:'#f0ece0', textMuted:'#7a7670', textDim:'#3a3630',
  success:'#4caf7d', error:'#e05c5c', warning:'#e8b84b',
}

// ── pdf.js loader ─────────────────────────────────────────────
let _pdfjsPromise = null
function loadPdfJs() {
  if (_pdfjsPromise) return _pdfjsPromise
  _pdfjsPromise = new Promise((resolve, reject) => {
    if (window.pdfjsLib) { resolve(window.pdfjsLib); return }
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      resolve(window.pdfjsLib)
    }
    s.onerror = () => reject(new Error('PDF.js yüklenemedi'))
    document.head.appendChild(s)
  })
  return _pdfjsPromise
}

async function pdfToImages(file, onProgress) {
  const lib = await loadPdfJs()
  const buf = await file.arrayBuffer()
  const pdf = await lib.getDocument({ data: buf }).promise
  const n = pdf.numPages
  const imgs = []
  for (let i = 1; i <= n; i++) {
    if (onProgress) onProgress(i, n)
    const page = await pdf.getPage(i)
    const base = page.getViewport({ scale: 1.0 })
    const scale = Math.min(1.8, 3200 / Math.max(base.width, base.height))
    const vp = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = vp.width; canvas.height = vp.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
    imgs.push(canvas.toDataURL('image/jpeg', 0.93).split(',')[1])
  }
  return { imgs, numPages: n }
}

// ── helpers ───────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return null
  const p = str.split('.'); if (p.length !== 3) return null
  const d = new Date(+p[2], +p[1]-1, +p[0])
  return isNaN(d.getTime()) ? null : d
}
function toMonthKey(str) {
  const d = parseDate(str); if (!d) return null
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}
function mlabel(key) {
  const mn = ['','Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık']
  const [y,m] = key.split('-'); return `${mn[+m]} ${y}`
}
function fmt(n) {
  if (n==null) return '—'
  return Number(n).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})
}
function daysUntil(str) {
  const d = parseDate(str); if (!d) return null
  const now = new Date(); now.setHours(0,0,0,0)
  return Math.ceil((d-now)/86400000)
}
function todayStr() {
  const t = new Date(), p = n => String(n).padStart(2,'0')
  return `${p(t.getDate())}.${p(t.getMonth()+1)}.${t.getFullYear()}`
}
function toBase64(file) {
  return new Promise((res,rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file)
  })
}
function createThumbnail(base64, w=160) {
  return new Promise(res => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = w; c.height = Math.round(w*(img.height/img.width))
      c.getContext('2d').drawImage(img,0,0,c.width,c.height)
      res(c.toDataURL('image/jpeg',0.72).split(',')[1])
    }
    img.src = `data:image/jpeg;base64,${base64}`
    img.onerror = () => res(null)
  })
}
function initials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()
}

// ── Supabase Storage helpers ──────────────────────────────────
const BUCKET = 'fatura-images'

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function b64ToBlob(base64) {
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: 'image/jpeg' })
}

async function uploadImage(base64, path) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, b64ToBlob(base64), { contentType:'image/jpeg', upsert:true })
  if (error) throw error
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

async function downloadFromUrl(url, filename) {
  const res = await fetch(url)
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = filename
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ── Compress base64 image to stay under Vercel 4.5MB limit ───
async function compressBase64(base64, maxKB=2800) {
  return new Promise(res => {
    const img = new Image()
    img.onload = () => {
      let scale = 1
      const bytes = (base64.length * 3) / 4
      if (bytes > maxKB * 1024) scale = Math.sqrt((maxKB * 1024) / bytes)
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      const ctx = c.getContext('2d')
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0, c.width, c.height)
      res(c.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.src = `data:image/jpeg;base64,${base64}`
  })
}
// ── API call (proxied through Vercel) ─────────────────────────
async function extractFromBase64(base64, mediaType) {
  const compressed = await compressBase64(base64)
  const res = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64: compressed, mediaType: 'image/jpeg' })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || 'API hatası')
  const txt = data.content.find(b=>b.type==='text')?.text || ''
  return JSON.parse(txt.replace(/```json|```/g,'').trim())
}

// ── data builders ─────────────────────────────────────────────
function buildProducts(invoices) {
  const map = {}
  invoices.forEach(inv => {
    const dt = parseDate(inv.date)
    ;(inv.items||[]).forEach(item => {
      if (!item.description) return
      const k = item.description.toLowerCase().trim()
      if (!map[k]) {
        map[k] = { name:item.description, unit:item.unit, latestPrice:item.unit_price, latestDate:inv.date, latestDt:dt, supplier:inv.supplier, currency:inv.currency||'TRY', min:item.unit_price, max:item.unit_price, count:1 }
      } else {
        if (dt&&map[k].latestDt&&dt>map[k].latestDt) { map[k].latestPrice=item.unit_price; map[k].latestDate=inv.date; map[k].latestDt=dt; map[k].supplier=inv.supplier }
        if (item.unit_price!=null) { map[k].min=Math.min(map[k].min,item.unit_price); map[k].max=Math.max(map[k].max,item.unit_price) }
        map[k].count++
      }
    })
  })
  return Object.values(map).sort((a,b)=>a.name.localeCompare(b.name,'tr'))
}

function buildSuppliers(invoices) {
  const map = {}
  invoices.forEach(inv => {
    if (!inv.supplier) return
    const key = inv.supplier.toLowerCase().trim()
    if (!map[key]) map[key] = { name:inv.supplier, phone:null, address:null, invoiceCount:0, totalSpent:0, lastDate:null, lastDateObj:null, products:{} }
    const s = map[key]
    if (!s.phone && inv.supplier_phone) s.phone = inv.supplier_phone
    if (!s.address && inv.supplier_address) s.address = inv.supplier_address
    const dt = parseDate(inv.date)
    if (!s.lastDateObj||(dt&&dt>s.lastDateObj)) { s.lastDate=inv.date; s.lastDateObj=dt }
    s.totalSpent += inv.total||0; s.invoiceCount++
    ;(inv.items||[]).forEach(item => {
      if (!item.description) return
      const pk = item.description.toLowerCase().trim()
      const ex = s.products[pk]
      if (!ex||(dt&&ex.dateParsed&&dt>ex.dateParsed))
        s.products[pk] = { name:item.description, unit:item.unit, price:item.unit_price, date:inv.date, dateParsed:dt, vat_rate:item.vat_rate, currency:inv.currency||'TRY' }
    })
  })
  return Object.values(map).sort((a,b)=>a.name.localeCompare(b.name,'tr'))
}

// ── small components ──────────────────────────────────────────
function Badge({color,children}) {
  const bg={red:`${C.error}25`,amber:`${C.warning}22`,green:`${C.success}22`,gray:`${C.textDim}35`}
  const fg={red:C.error,amber:C.warning,green:C.success,gray:C.textMuted}
  return <span style={{background:bg[color]||bg.gray,color:fg[color]||fg.gray,fontSize:11,padding:'2px 8px',borderRadius:4,fontWeight:500,whiteSpace:'nowrap'}}>{children}</span>
}
function Empty({icon,text}) {
  return <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:240,gap:12,color:C.textMuted}}>
    <div style={{fontSize:40,opacity:0.15}}>{icon}</div>
    <div style={{fontSize:13}}>{text}</div>
  </div>
}
const TH = {padding:'9px 14px',textAlign:'left',color:C.textMuted,fontSize:11,fontWeight:400,borderBottom:`1px solid ${C.border}`,whiteSpace:'nowrap',background:C.surface}
const TD = {padding:'11px 14px',borderBottom:`1px solid ${C.border}`,fontSize:13}

// ── MAIN APP ──────────────────────────────────────────────────
export default function App() {
  const [user, setUser]                    = useState(null)
  const [authLoading, setAuthLoading]      = useState(true)
  const [invoices, setInvoices]            = useState([])
  const [paidMap, setPaidMap]              = useState({})
  const [tab, setTab]                      = useState('faturalar')
  const [month, setMonth]                  = useState('all')
  const [selected, setSelected]            = useState(null)
  const [selectedSupplier, setSelSupplier] = useState(null)
  const [dTab, setDTab]                    = useState('ozet')
  const [processing, setProcessing]        = useState(false)
  const [progress, setProgress]            = useState(null)
  const [errors, setErrors]               = useState([])
  const [dragging, setDragging]            = useState(false)
  const [loaded, setLoaded]               = useState(false)
  const [lightbox, setLightbox]            = useState(null)
  const [searchFat, setSearchFat]          = useState('')
  const [searchProd, setSearchProd]        = useState('')
  const inputRef = useRef()

  // ── Auth ────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null); setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // ── Load data from Supabase ──────────────────────────────────
  useEffect(() => {
    if (!user) return
    ;(async () => {
      const [{ data: invRows }, { data: paidRows }] = await Promise.all([
        supabase.from('invoices').select('*').order('created_at', { ascending: true }),
        supabase.from('paid_status').select('*')
      ])
      if (invRows) {
        setInvoices(invRows.map(row => ({
          ...row.data,
          _id: row.id, _file: row.file_name,
          _thumbUrl: row.thumb_path ? supabase.storage.from(BUCKET).getPublicUrl(row.thumb_path).data.publicUrl : null,
          _fullUrl:  row.image_path ? supabase.storage.from(BUCKET).getPublicUrl(row.image_path).data.publicUrl : null,
        })))
      }
      if (paidRows) {
        const pm = {}
        paidRows.forEach(p => { pm[p.invoice_id] = { date:p.paid_date, amount:p.paid_amount } })
        setPaidMap(pm)
      }
      setLoaded(true)
    })()
  }, [user])

  // ── Derived data ─────────────────────────────────────────────
  const availableMonths = useMemo(() => {
    const s = new Set()
    invoices.forEach(inv => { const m1=toMonthKey(inv.date); if(m1)s.add(m1); const m2=toMonthKey(inv.due_date); if(m2)s.add(m2) })
    Object.values(paidMap).forEach(p => { const m=toMonthKey(p.date); if(m)s.add(m) })
    return Array.from(s).sort().reverse()
  }, [invoices, paidMap])

  const filtInv    = useMemo(() => month==='all'?invoices:invoices.filter(inv=>toMonthKey(inv.date)===month), [invoices,month])
  const products   = useMemo(() => buildProducts(filtInv), [filtInv])
  const suppliers  = useMemo(() => buildSuppliers(filtInv), [filtInv])

  const dueInv = useMemo(() => {
    const u = invoices.filter(inv=>inv.due_date&&!paidMap[inv._id])
    const f = month==='all'?u:u.filter(inv=>toMonthKey(inv.due_date)===month)
    return f.sort((a,b)=>{const da=parseDate(a.due_date),db=parseDate(b.due_date);if(!da&&!db)return 0;if(!da)return 1;if(!db)return -1;return da-db})
  }, [invoices,paidMap,month])

  const paidInv = useMemo(() => {
    const p = invoices.filter(inv=>paidMap[inv._id])
    const f = month==='all'?p:p.filter(inv=>toMonthKey(paidMap[inv._id]?.date)===month)
    return f.sort((a,b)=>{const da=parseDate(paidMap[a._id]?.date),db=parseDate(paidMap[b._id]?.date);if(!da&&!db)return 0;if(!da)return 1;if(!db)return -1;return db-da})
  }, [invoices,paidMap,month])

  const totals = useMemo(() => ({
    sub:filtInv.reduce((s,i)=>s+(i.subtotal||0),0),
    vat:filtInv.reduce((s,i)=>s+(i.vat_amount||0),0),
    total:filtInv.reduce((s,i)=>s+(i.total||0),0)
  }), [filtInv])

  const cumulativeTotal = useMemo(() => invoices.filter(inv=>paidMap[inv._id]).reduce((s,inv)=>s+(inv.total||0),0), [invoices,paidMap])
  const dueBadge = dueInv.filter(inv=>{const d=daysUntil(inv.due_date);return d!==null&&d<=7}).length

  const displayInv = useMemo(() => {
    const q = searchFat.toLowerCase().trim(); if(!q) return filtInv
    return filtInv.filter(inv=>(inv.supplier||'').toLowerCase().includes(q)||(inv.invoice_number||'').toLowerCase().includes(q)||(inv.items||[]).some(it=>(it.description||'').toLowerCase().includes(q)))
  }, [filtInv,searchFat])

  const displayProducts = useMemo(() => {
    const q = searchProd.toLowerCase().trim(); if(!q) return products
    return products.filter(p=>p.name.toLowerCase().includes(q)||(p.supplier||'').toLowerCase().includes(q))
  }, [products,searchProd])

  const supplierProducts = useMemo(() => {
    if (!selectedSupplier) return []
    return Object.values(selectedSupplier.products).sort((a,b)=>a.name.localeCompare(b.name,'tr'))
  }, [selectedSupplier])

  useEffect(() => {
    if (!selectedSupplier) return
    const updated = suppliers.find(s=>s.name.toLowerCase()===selectedSupplier.name.toLowerCase())
    setSelSupplier(updated||null)
  }, [suppliers])

  // ── Handlers ─────────────────────────────────────────────────
  const processFiles = useCallback(async files => {
    setProcessing(true); setErrors([]); const errs = []

    for (const file of files) {
      const isImg = file.type.startsWith('image/'), isPdf = file.type==='application/pdf'
      if (!isImg&&!isPdf) { errs.push(`${file.name}: Desteklenmeyen format`); continue }

      if (isPdf) {
  setProgress({file:file.name, step:1, total:1, phase:'extract'})
  const id = crypto.randomUUID()
  try {
    const buf = await file.arrayBuffer()
    const b64 = arrayBufferToBase64(buf)
    const [fullUrl] = await Promise.all([
      uploadImage(b64, `${id}_full.jpg`),
    ])
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: b64, mediaType: 'application/pdf', isPdf: true })
    })
    const apiData = await res.json()
    if (!res.ok) throw new Error(apiData?.error?.message || 'API hatası')
    const txt = apiData.content.find(b=>b.type==='text')?.text || ''
    const data = JSON.parse(txt.replace(/```json|```/g,'').trim())
    await supabase.from('invoices').insert({ id, data, file_name:file.name, image_path:`${id}_full.jpg`, thumb_path:null })
    setInvoices(prev=>[...prev,{...data,_id:id,_file:file.name,_fullUrl:fullUrl,_thumbUrl:null}])
  } catch(e) { errs.push(`${file.name}: ${e.message}`) }
      } else {
        setProgress({file:file.name,step:1,total:1,phase:'extract'})
        const id = crypto.randomUUID()
        try {
          const b64   = await toBase64(file)
          const thumb = await createThumbnail(b64)
          const [fullUrl, thumbUrl] = await Promise.all([
            uploadImage(b64, `${id}_full.jpg`),
            thumb ? uploadImage(thumb, `${id}_thumb.jpg`) : Promise.resolve(null)
          ])
          const data = await extractFromBase64(b64, file.type||'image/jpeg')
          await supabase.from('invoices').insert({ id, data, file_name:file.name, image_path:`${id}_full.jpg`, thumb_path:thumb?`${id}_thumb.jpg`:null })
          setInvoices(prev=>[...prev,{...data,_id:id,_file:file.name,_fullUrl:fullUrl,_thumbUrl:thumbUrl}])
        } catch(e) { errs.push(`${file.name}: ${e.message}`) }
      }
    }
    setProgress(null); setErrors(errs); setProcessing(false)
  }, [])

  const markPaid = useCallback(async inv => {
    const date = todayStr()
    await supabase.from('paid_status').upsert({ invoice_id:inv._id, paid_date:date, paid_amount:inv.total })
    setPaidMap(p=>({...p,[inv._id]:{date,amount:inv.total}}))
  }, [])

  const markUnpaid = useCallback(async inv => {
    await supabase.from('paid_status').delete().eq('invoice_id',inv._id)
    setPaidMap(p=>{const n={...p};delete n[inv._id];return n})
  }, [])

  const removeInv = useCallback(async id => {
    await Promise.all([
      supabase.from('invoices').delete().eq('id',id),
      supabase.storage.from(BUCKET).remove([`${id}_full.jpg`,`${id}_thumb.jpg`])
    ])
    setInvoices(p=>p.filter(i=>i._id!==id))
    if (selected?._id===id) setSelected(null)
  }, [selected])

  const exportXlsx = useCallback(() => {
    const wb = XLSX.utils.book_new(), src = filtInv
    const s1 = [['Tedarikçi','Tel','Adres','Fatura No','Tarih','Vade','Ara Toplam','KDV%','KDV','Toplam','Döviz','Durum']]
    src.forEach(inv=>s1.push([inv.supplier||'',inv.supplier_phone||'',inv.supplier_address||'',inv.invoice_number||'',inv.date||'',inv.due_date||'',inv.subtotal||0,inv.vat_rate||0,inv.vat_amount||0,inv.total||0,inv.currency||'TRY',paidMap[inv._id]?'Ödendi':'Bekliyor']))
    const ws1=XLSX.utils.aoa_to_sheet(s1); ws1['!cols']=[20,14,24,15,12,12,13,7,13,13,8,10].map(w=>({wch:w}))
    XLSX.utils.book_append_sheet(wb,ws1,'Özet')
    const s2 = [['Tedarikçi','Fatura No','Tarih','Ürün','Miktar','Birim','Birim Fiyat','KDV%','Satır Toplam']]
    src.forEach(inv=>(inv.items||[]).forEach(it=>s2.push([inv.supplier||'',inv.invoice_number||'',inv.date||'',it.description||'',it.quantity||0,it.unit||'',it.unit_price||0,it.vat_rate||0,it.line_total||0])))
    const ws2=XLSX.utils.aoa_to_sheet(s2); ws2['!cols']=[20,15,12,24,8,8,12,7,12].map(w=>({wch:w}))
    XLSX.utils.book_append_sheet(wb,ws2,'Detay')
    const s3 = [['Firma','Tel','Adres','Ürün','Birim Fiyat','Birim','KDV%','Son Fatura']]
    suppliers.forEach(sup=>Object.values(sup.products).sort((a,b)=>a.name.localeCompare(b.name,'tr')).forEach(p=>s3.push([sup.name,sup.phone||'',sup.address||'',p.name,p.price,p.unit||'',p.vat_rate||'',p.date||''])))
    const ws3=XLSX.utils.aoa_to_sheet(s3); ws3['!cols']=[22,14,28,24,12,8,7,12].map(w=>({wch:w}))
    XLSX.utils.book_append_sheet(wb,ws3,'Firmalar')
    XLSX.writeFile(wb, month!=='all'?`faturalar_${month}.xlsx`:'faturalar_tumu.xlsx')
  }, [filtInv,suppliers,paidMap,month])

  const progressLabel = () => {
    if (!progress) return null
    if (progress.phase==='split') return progress.total>0?`PDF ayrıştırılıyor... ${progress.step}/${progress.total}`:'PDF açılıyor...'
    return `Fatura okunuyor... ${progress.total>1?`${progress.step}/${progress.total}`:''}`
  }
  const progressPct = () => (!progress||!progress.total) ? 0 : Math.round((progress.step/progress.total)*100)

  // ── Auth guards ───────────────────────────────────────────────
  if (authLoading) return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',color:C.textMuted,fontFamily:"'DM Mono',monospace"}}>
      Yükleniyor...
    </div>
  )
  if (!user) return <Login/>

  // ── render ───────────────────────────────────────────────────
  return (
    <div style={{minHeight:'100vh',background:C.bg,color:C.text,fontFamily:"'DM Mono',monospace",fontSize:13}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700&display=swap" rel="stylesheet"/>

      {/* TOP BAR */}
      <div style={{borderBottom:`1px solid ${C.border}`,padding:'0 24px',display:'flex',alignItems:'center',gap:12,height:54}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginRight:'auto'}}>
          <div style={{width:26,height:26,background:C.accent,borderRadius:5,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13}}>◈</div>
          <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,letterSpacing:'0.03em'}}>FaturaOku</span>
        </div>
        <select value={month} onChange={e=>setMonth(e.target.value)} style={{background:C.surface,color:C.text,border:`1px solid ${C.border}`,borderRadius:6,padding:'5px 10px',fontFamily:"'DM Mono',monospace",fontSize:12,cursor:'pointer',outline:'none'}}>
          <option value="all">Tüm dönemler</option>
          {availableMonths.map(m=><option key={m} value={m}>{mlabel(m)}</option>)}
        </select>
        <button onClick={exportXlsx} disabled={!invoices.length} style={{background:invoices.length?C.accent:'transparent',color:invoices.length?'#0f0f0f':C.textDim,border:`1px solid ${invoices.length?C.accent:C.border}`,borderRadius:6,padding:'5px 14px',cursor:invoices.length?'pointer':'default',fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:500}}>
          ⬇ Excel
        </button>
        <button onClick={()=>supabase.auth.signOut()} title="Çıkış yap" style={{background:'none',border:`1px solid ${C.border}`,color:C.textMuted,borderRadius:6,padding:'5px 10px',cursor:'pointer',fontSize:13}}>
          ⎋
        </button>
      </div>

      {/* TAB NAV */}
      <div style={{borderBottom:`1px solid ${C.border}`,padding:'0 24px',display:'flex',gap:2}}>
        {[
          {key:'faturalar',label:'Faturalar',n:filtInv.length},
          {key:'firmalar', label:'Firmalar', n:suppliers.length},
          {key:'urunler',  label:'Ürünler',  n:products.length},
          {key:'vadeler',  label:'Vadeler',  n:dueInv.length,badge:dueBadge},
          {key:'odendi',   label:'Ödendi',   n:paidInv.length},
        ].map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)} style={{background:'none',border:'none',cursor:'pointer',padding:'13px 14px 11px',fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:500,color:tab===t.key?C.text:C.textMuted,borderBottom:tab===t.key?`2px solid ${C.accent}`:'2px solid transparent',display:'flex',alignItems:'center',gap:5,transition:'color 0.15s'}}>
            {t.label}<span style={{fontSize:11,color:tab===t.key?C.accentDim:C.textDim}}>{t.n}</span>
            {t.badge>0&&<span style={{background:C.error,color:'#fff',fontSize:10,padding:'1px 5px',borderRadius:8,fontWeight:500,lineHeight:'14px'}}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* CONTENT */}
      <div style={{height:'calc(100vh - 102px)',overflow:'hidden'}}>

        {/* ═══ FATURALAR ═══ */}
        {tab==='faturalar'&&(
          <div style={{display:'grid',gridTemplateColumns:filtInv.length?'300px 1fr':'1fr',height:'100%'}}>
            <div style={{borderRight:filtInv.length?`1px solid ${C.border}`:'none',display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <div style={{padding:'14px 14px 10px'}}>
                <div onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);processFiles(Array.from(e.dataTransfer.files))}} onClick={()=>!processing&&inputRef.current.click()}
                  style={{border:`1.5px dashed ${dragging?C.accent:C.border}`,borderRadius:8,padding:'16px 12px',textAlign:'center',cursor:processing?'default':'pointer',background:dragging?`${C.accent}10`:'transparent',transition:'all 0.2s'}}>
                  {processing&&progress?(
                    <>
                      <div style={{fontSize:18,marginBottom:6,animation:'spin 1.5s linear infinite',display:'inline-block'}}>⟳</div>
                      <div style={{color:C.text,fontWeight:500,fontSize:13,marginBottom:4}}>{progressLabel()}</div>
                      <div style={{color:C.textMuted,fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:progress.total>1?8:0}}>{progress.file}</div>
                      {progress.total>1&&<div style={{height:3,background:C.border,borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',background:C.accent,borderRadius:2,width:`${progressPct()}%`,transition:'width 0.4s ease'}}/></div>}
                    </>
                  ):(
                    <>
                      <div style={{fontSize:20,marginBottom:5}}>📄</div>
                      <div style={{color:C.text,fontWeight:500,fontSize:13}}>Fatura yükle</div>
                      <div style={{color:C.textMuted,fontSize:11,marginTop:3}}>JPG · PNG · PDF (çoklu sayfa)</div>
                    </>
                  )}
                </div>
                <input ref={inputRef} type="file" multiple accept="image/*,application/pdf" onChange={e=>{processFiles(Array.from(e.target.files));e.target.value=''}} style={{display:'none'}}/>
              </div>

              {errors.map((err,i)=><div key={i} style={{margin:'0 14px 6px',padding:'6px 10px',background:`${C.error}15`,border:`1px solid ${C.error}30`,borderRadius:6,fontSize:11,color:C.error}}>⚠ {err}</div>)}

              {filtInv.length>0&&(
                <>
                  <div style={{padding:'0 14px 8px'}}>
                    <div style={{position:'relative'}}>
                      <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:C.textDim,fontSize:14,pointerEvents:'none'}}>⌕</span>
                      <input value={searchFat} onChange={e=>setSearchFat(e.target.value)} placeholder="Firma, fatura no veya ürün..." style={{width:'100%',background:C.surface,color:C.text,border:`1px solid ${searchFat?C.accentDim:C.border}`,borderRadius:6,padding:'7px 30px 7px 30px',fontFamily:"'DM Mono',monospace",fontSize:12,outline:'none',boxSizing:'border-box'}}/>
                      {searchFat&&<button onClick={()=>setSearchFat('')} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:C.textMuted,fontSize:15,padding:0,lineHeight:1}}>×</button>}
                    </div>
                    {searchFat&&<div style={{fontSize:11,color:C.textMuted,marginTop:4}}>{displayInv.length} sonuç</div>}
                  </div>
                  <div style={{padding:'0 14px 10px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:7}}>
                    {[['Ara',fmt(totals.sub)],['KDV',fmt(totals.vat)],['Toplam',fmt(totals.total)]].map(([l,v])=>(
                      <div key={l} style={{background:C.surface,borderRadius:6,padding:'7px 8px',border:`1px solid ${C.border}`}}>
                        <div style={{color:C.textMuted,fontSize:10,marginBottom:2}}>{l}</div>
                        <div style={{color:C.accent,fontWeight:500,fontSize:11,wordBreak:'break-all'}}>₺{v}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{flex:1,overflowY:'auto',padding:'0 10px'}}>
                {displayInv.map(inv=>(
                  <div key={inv._id} style={{display:'flex',gap:9,padding:'8px 10px',borderRadius:7,marginBottom:3,background:selected?._id===inv._id?C.surface:'transparent',border:`1px solid ${selected?._id===inv._id?C.border:'transparent'}`,transition:'all 0.12s',alignItems:'center'}}>
                    <div onClick={()=>inv._fullUrl&&setLightbox({url:inv._fullUrl,filename:inv._file})} style={{flexShrink:0,width:38,height:52,borderRadius:4,border:`1px solid ${C.border}`,overflow:'hidden',background:C.surfaceAlt,display:'flex',alignItems:'center',justifyContent:'center',cursor:inv._thumbUrl?'pointer':'default'}}>
                      {inv._thumbUrl ? <img src={inv._thumbUrl} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/> : <span style={{fontSize:14,opacity:0.25}}>📄</span>}
                    </div>
                    <div onClick={()=>setSelected(inv)} style={{flex:1,minWidth:0,cursor:'pointer'}}>
                      <div style={{color:C.text,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:13}}>{inv.supplier||'—'}</div>
                      <div style={{color:C.textMuted,fontSize:11,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{inv.invoice_number||'—'} · {inv.date||'—'}</div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,flexShrink:0}}>
                      <span style={{color:C.accent,fontWeight:500,fontSize:12,whiteSpace:'nowrap'}}>{fmt(inv.total)} ₺</span>
                      <button onClick={()=>removeInv(inv._id)} style={{background:'none',border:'none',cursor:'pointer',color:C.textDim,fontSize:16,padding:0,lineHeight:1}}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {filtInv.length===0?<Empty icon="◈" text="Fatura yükleyerek başla — tekli görsel veya çok sayfalı PDF"/>
            :selected?(
              <div style={{overflowY:'auto',padding:26}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:22}}>
                  <div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:19}}>{selected.supplier||'—'}</div>
                    <div style={{color:C.textMuted,fontSize:12,marginTop:3}}>{selected._file}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:21,fontWeight:500,color:C.accent}}>{fmt(selected.total)} {selected.currency||'TRY'}</div>
                    <div style={{fontSize:11,color:C.textMuted,marginTop:2}}>Genel Toplam</div>
                  </div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:9,marginBottom:20}}>
                  {[['Fatura No',selected.invoice_number],['Tarih',selected.date],['Vade',selected.due_date],['KDV',selected.vat_rate!=null?`%${selected.vat_rate}`:null]].map(([l,v])=>(
                    <div key={l} style={{background:C.surface,borderRadius:7,padding:'9px 11px',border:`1px solid ${C.border}`}}><div style={{color:C.textMuted,fontSize:10,marginBottom:4}}>{l}</div><div style={{color:C.text,fontWeight:500}}>{v||'—'}</div></div>
                  ))}
                </div>
                <div style={{display:'flex',gap:4,marginBottom:14,borderBottom:`1px solid ${C.border}`,paddingBottom:12}}>
                  {[['ozet','Özet'],['detay','Kalem Detayı']].map(([k,l])=>(
                    <button key={k} onClick={()=>setDTab(k)} style={{background:dTab===k?C.accent:'transparent',color:dTab===k?'#0f0f0f':C.textMuted,border:'none',borderRadius:6,padding:'5px 12px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:500}}>{l}</button>
                  ))}
                </div>
                {dTab==='ozet'&&(
                  <div style={{background:C.surface,borderRadius:9,border:`1px solid ${C.border}`,overflow:'hidden'}}>
                    {[['Tedarikçi',selected.supplier],['Telefon',selected.supplier_phone],['Adres',selected.supplier_address],['Fatura No',selected.invoice_number],['Tarih',selected.date],['Vade',selected.due_date],['Ara Toplam',`${fmt(selected.subtotal)} ${selected.currency||'TRY'}`],['KDV Oranı',selected.vat_rate!=null?`%${selected.vat_rate}`:null],['KDV Tutarı',`${fmt(selected.vat_amount)} ${selected.currency||'TRY'}`],['Genel Toplam',`${fmt(selected.total)} ${selected.currency||'TRY'}`]].map(([l,v],i,arr)=>(
                      <div key={l} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 15px',borderBottom:i<arr.length-1?`1px solid ${C.border}`:'none',background:i===arr.length-1?`${C.accent}10`:'transparent'}}>
                        <span style={{color:C.textMuted}}>{l}</span>
                        <span style={{color:i===arr.length-1?C.accent:C.text,fontWeight:i===arr.length-1?500:400}}>{v||'—'}</span>
                      </div>
                    ))}
                  </div>
                )}
                {dTab==='detay'&&(
                  <div style={{background:C.surface,borderRadius:9,border:`1px solid ${C.border}`,overflow:'hidden'}}>
                    <table style={{width:'100%',borderCollapse:'collapse'}}>
                      <thead><tr>{['Ürün/Hizmet','Miktar','Birim','Birim Fiyat','KDV%','Toplam'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                      <tbody>{(selected.items||[]).map((item,i)=>(
                        <tr key={i}><td style={{...TD,color:C.text,fontWeight:500}}>{item.description||'—'}</td><td style={{...TD,color:C.textMuted}}>{item.quantity??''}</td><td style={{...TD,color:C.textMuted}}>{item.unit||''}</td><td style={TD}>{fmt(item.unit_price)}</td><td style={{...TD,color:C.textMuted}}>%{item.vat_rate??''}</td><td style={{...TD,color:C.accent,fontWeight:500}}>{fmt(item.line_total)}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>
            ):<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:C.textMuted}}>Detay için bir fatura seç</div>}
          </div>
        )}

        {/* ═══ FİRMALAR ═══ */}
        {tab==='firmalar'&&(
          <div style={{display:'grid',gridTemplateColumns:suppliers.length?'280px 1fr':'1fr',height:'100%'}}>
            <div style={{borderRight:suppliers.length?`1px solid ${C.border}`:'none',overflowY:'auto',padding:'12px 10px'}}>
              {suppliers.length===0?<Empty icon="🏢" text="Fatura yüklendiğinde firmalar burada görünür"/>:
                suppliers.map(sup=>{
                  const isSel = selectedSupplier?.name===sup.name
                  return (
                    <div key={sup.name} onClick={()=>setSelSupplier(sup)} style={{padding:'11px 12px',borderRadius:8,marginBottom:4,cursor:'pointer',background:isSel?C.surface:'transparent',border:`1px solid ${isSel?C.border:'transparent'}`,transition:'all 0.12s',display:'flex',alignItems:'center',gap:12}}>
                      <div style={{width:36,height:36,borderRadius:8,background:`${C.accent}20`,border:`1px solid ${C.accent}30`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:500,color:C.accent,flexShrink:0}}>{initials(sup.name)}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{color:C.text,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:13}}>{sup.name}</div>
                        <div style={{color:C.textMuted,fontSize:11,marginTop:2}}>{sup.phone||<span style={{color:C.textDim}}>—</span>}</div>
                        <div style={{color:C.textDim,fontSize:11,marginTop:1}}>{sup.invoiceCount} fatura · ₺{fmt(sup.totalSpent)}</div>
                      </div>
                    </div>
                  )
                })
              }
            </div>
            {!selectedSupplier?(
              <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:C.textMuted,flexDirection:'column',gap:10}}>
                <div style={{fontSize:36,opacity:0.1}}>🏢</div>
                <div>Detay için bir firma seç</div>
              </div>
            ):(
              <div style={{overflowY:'auto',padding:28}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:20}}>
                  <div style={{display:'flex',alignItems:'center',gap:14}}>
                    <div style={{width:48,height:48,borderRadius:10,background:`${C.accent}20`,border:`1px solid ${C.accent}35`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,fontWeight:500,color:C.accent}}>{initials(selectedSupplier.name)}</div>
                    <div>
                      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:19,color:C.text}}>{selectedSupplier.name}</div>
                      <div style={{color:C.textMuted,fontSize:12,marginTop:3}}>Son fatura: {selectedSupplier.lastDate||'—'}</div>
                    </div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:21,fontWeight:500,color:C.accent}}>₺{fmt(selectedSupplier.totalSpent)}</div>
                    <div style={{fontSize:11,color:C.textMuted,marginTop:2}}>toplam · {selectedSupplier.invoiceCount} fatura</div>
                  </div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:24}}>
                  {[['📞 Telefon',selectedSupplier.phone],['📍 Adres',selectedSupplier.address]].map(([l,v])=>(
                    <div key={l} style={{background:C.surface,borderRadius:8,padding:'12px 14px',border:`1px solid ${C.border}`}}>
                      <div style={{color:C.textMuted,fontSize:11,marginBottom:5}}>{l}</div>
                      <div style={{color:v?C.text:C.textDim,fontWeight:v?500:400,fontSize:12,lineHeight:1.5}}>{v||'Faturada bilgi yok'}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginBottom:12,color:C.textMuted,fontSize:12}}>Güncel fiyatlar — son faturaya göre</div>
                {supplierProducts.length===0?<div style={{color:C.textDim,fontSize:13}}>Bu firmaya ait ürün kalemi bulunamadı.</div>:(
                  <div style={{background:C.surface,borderRadius:10,border:`1px solid ${C.border}`,overflow:'hidden'}}>
                    <table style={{width:'100%',borderCollapse:'collapse'}}>
                      <thead><tr>{['Ürün / Hizmet','Güncel Fiyat','Birim','KDV','Son Fatura'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                      <tbody>
                        {supplierProducts.map((p,i)=>(
                          <tr key={i} style={{background:i%2===0?'transparent':`${C.bg}60`}}>
                            <td style={{...TD,color:C.text,fontWeight:500}}>{p.name}</td>
                            <td style={{...TD,color:C.accent,fontWeight:500}}>{fmt(p.price)} <span style={{color:C.textDim,fontWeight:400,fontSize:11}}>{p.currency}</span></td>
                            <td style={{...TD,color:C.textMuted,fontSize:12}}>{p.unit||'—'}</td>
                            <td style={{...TD,color:C.textMuted,fontSize:12}}>{p.vat_rate!=null?`%${p.vat_rate}`:'—'}</td>
                            <td style={{...TD,color:C.textMuted,fontSize:12}}>{p.date||'—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══ ÜRÜNLER ═══ */}
        {tab==='urunler'&&(
          <div style={{overflowY:'auto',height:'100%',padding:24}}>
            {products.length===0?<Empty icon="◫" text="Fatura yüklendiğinde ürün fiyatları burada birikir"/>:(
              <>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:16}}>
                  {[['Toplam Ürün',`${products.length} çeşit`],['Farklı Tedarikçi',`${suppliers.length} firma`],['Toplam Kayıt',`${products.reduce((s,p)=>s+p.count,0)} görülme`]].map(([l,v])=>(
                    <div key={l} style={{background:C.surface,borderRadius:8,padding:'12px 14px',border:`1px solid ${C.border}`}}><div style={{color:C.textMuted,fontSize:11,marginBottom:5}}>{l}</div><div style={{color:C.text,fontWeight:500,fontSize:15}}>{v}</div></div>
                  ))}
                </div>
                <div style={{position:'relative',marginBottom:16}}>
                  <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:C.textDim,fontSize:14,pointerEvents:'none'}}>⌕</span>
                  <input value={searchProd} onChange={e=>setSearchProd(e.target.value)} placeholder="Ürün adı veya firma..." style={{width:'100%',background:C.surface,color:C.text,border:`1px solid ${searchProd?C.accentDim:C.border}`,borderRadius:7,padding:'9px 36px 9px 34px',fontFamily:"'DM Mono',monospace",fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                  {searchProd&&<button onClick={()=>setSearchProd('')} style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:C.textMuted,fontSize:16,padding:0,lineHeight:1}}>×</button>}
                  {searchProd&&<div style={{fontSize:11,color:C.textMuted,marginTop:5}}>{displayProducts.length} sonuç</div>}
                </div>
                <div style={{background:C.surface,borderRadius:10,border:`1px solid ${C.border}`,overflow:'hidden'}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead><tr>{['Ürün / Hizmet','Güncel Fiyat','Min','Maks','Birim','Son Tedarikçi','Son Görülme','Tekrar'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                    <tbody>
                      {displayProducts.length===0
                        ?<tr><td colSpan={8} style={{...TD,textAlign:'center',color:C.textMuted,padding:'28px 14px'}}>"{searchProd}" için sonuç bulunamadı</td></tr>
                        :displayProducts.map((p,i)=>{
                          const diff=p.max!==p.min?Math.round(((p.max-p.min)/p.min)*100):0
                          return (
                            <tr key={i} style={{background:i%2===0?'transparent':`${C.bg}60`}}>
                              <td style={{...TD,color:C.text,fontWeight:500}}>{p.name}</td>
                              <td style={{...TD,color:C.accent,fontWeight:500}}>{fmt(p.latestPrice)} <span style={{color:C.textDim,fontWeight:400,fontSize:11}}>{p.currency}</span></td>
                              <td style={{...TD,color:C.success,fontSize:12}}>{fmt(p.min)}</td>
                              <td style={{...TD,fontSize:12}}><span style={{color:diff>20?C.error:diff>0?C.warning:C.textMuted}}>{fmt(p.max)}</span>{diff>0&&<span style={{fontSize:10,color:C.error,marginLeft:5}}>+%{diff}</span>}</td>
                              <td style={{...TD,color:C.textMuted,fontSize:12}}>{p.unit||'—'}</td>
                              <td style={{...TD,color:C.textMuted,fontSize:12}}>{p.supplier||'—'}</td>
                              <td style={{...TD,color:C.textMuted,fontSize:12}}>{p.latestDate||'—'}</td>
                              <td style={{...TD,textAlign:'center'}}><span style={{color:C.textDim,fontSize:12}}>{p.count}×</span></td>
                            </tr>
                          )
                        })
                      }
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══ VADELER ═══ */}
        {tab==='vadeler'&&(
          <div style={{overflowY:'auto',height:'100%',padding:24}}>
            {dueInv.length===0?<Empty icon="◷" text="Vadesi yaklaşan veya geçmiş fatura bulunmuyor"/>:(
              <>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
                  {[['Toplam Bekleyen',`${dueInv.length} fatura`,C.text],['Gecikmiş',`${dueInv.filter(i=>{const d=daysUntil(i.due_date);return d!==null&&d<0}).length} fatura`,C.error],['Bu Hafta',`${dueInv.filter(i=>{const d=daysUntil(i.due_date);return d!==null&&d>=0&&d<=7}).length} fatura`,C.warning],['Toplam Tutar',`₺${fmt(dueInv.reduce((s,i)=>s+(i.total||0),0))}`,C.accent]].map(([l,v,col])=>(
                    <div key={l} style={{background:C.surface,borderRadius:8,padding:'12px 14px',border:`1px solid ${C.border}`}}><div style={{color:C.textMuted,fontSize:11,marginBottom:5}}>{l}</div><div style={{color:col,fontWeight:500,fontSize:15}}>{v}</div></div>
                  ))}
                </div>
                <div style={{background:C.surface,borderRadius:10,border:`1px solid ${C.border}`,overflow:'hidden'}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead><tr>{['Tedarikçi','Fatura No','Tarih','Vade','Durum','Tutar',''].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                    <tbody>
                      {dueInv.map(inv=>{
                        const days=daysUntil(inv.due_date),over=days!==null&&days<0,soon=days!==null&&days>=0&&days<=7
                        return (
                          <tr key={inv._id} style={{background:over?`${C.error}08`:soon?`${C.warning}06`:'transparent'}}>
                            <td style={{...TD,color:C.text,fontWeight:500}}>{inv.supplier||'—'}</td>
                            <td style={{...TD,color:C.textMuted,fontSize:12}}>{inv.invoice_number||'—'}</td>
                            <td style={{...TD,color:C.textMuted,fontSize:12}}>{inv.date||'—'}</td>
                            <td style={{...TD,color:C.text}}>{inv.due_date||'—'}</td>
                            <td style={TD}>
                              {over&&<Badge color="red">{Math.abs(days)} gün gecikmiş</Badge>}
                              {soon&&<Badge color="amber">{days===0?'Bugün vadeli':`${days} gün kaldı`}</Badge>}
                              {!over&&!soon&&<Badge color="gray">{days} gün kaldı</Badge>}
                            </td>
                            <td style={{...TD,color:C.accent,fontWeight:500}}>{fmt(inv.total)} {inv.currency||'₺'}</td>
                            <td style={TD}><button onClick={()=>markPaid(inv)} style={{background:C.success,color:'#fff',border:'none',borderRadius:6,padding:'5px 12px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:500}}>✓ Ödendi</button></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══ ÖDENDİ ═══ */}
        {tab==='odendi'&&(
          <div style={{overflowY:'auto',height:'100%',padding:24}}>
            <div style={{background:`${C.accent}10`,border:`1px solid ${C.accent}28`,borderRadius:10,padding:'20px 24px',marginBottom:20,display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:16}}>
              <div>
                <div style={{color:C.accentDim,fontSize:12,marginBottom:5}}>Kümülatif Toplam (Tüm Zamanlar)</div>
                <div style={{color:C.accent,fontSize:26,fontWeight:500}}>₺{fmt(cumulativeTotal)}</div>
                <div style={{color:C.textMuted,fontSize:12,marginTop:4}}>{invoices.filter(i=>paidMap[i._id]).length} fatura ödendi</div>
              </div>
              <div style={{textAlign:'right',borderLeft:`1px solid ${C.accent}20`,paddingLeft:24}}>
                <div style={{color:C.textMuted,fontSize:12,marginBottom:5}}>{month!=='all'?mlabel(month)+' dönemi':'Gösterilen dönem'}</div>
                <div style={{color:C.text,fontSize:20,fontWeight:500}}>₺{fmt(paidInv.reduce((s,i)=>s+(i.total||0),0))}</div>
                <div style={{color:C.textMuted,fontSize:12,marginTop:4}}>{paidInv.length} fatura</div>
              </div>
            </div>
            {paidInv.length===0?<Empty icon="✓" text="Ödendi işaretlenen faturalar burada birikir"/>:(
              <div style={{background:C.surface,borderRadius:10,border:`1px solid ${C.border}`,overflow:'hidden'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Tedarikçi','Fatura No','Fatura Tarihi','Vade','Ödeme Tarihi','Tutar',''].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>
                    {paidInv.map(inv=>(
                      <tr key={inv._id}>
                        <td style={{...TD,color:C.text,fontWeight:500}}>{inv.supplier||'—'}</td>
                        <td style={{...TD,color:C.textMuted,fontSize:12}}>{inv.invoice_number||'—'}</td>
                        <td style={{...TD,color:C.textMuted,fontSize:12}}>{inv.date||'—'}</td>
                        <td style={{...TD,color:C.textMuted,fontSize:12}}>{inv.due_date||'—'}</td>
                        <td style={TD}><Badge color="green">{paidMap[inv._id]?.date||'—'}</Badge></td>
                        <td style={{...TD,color:C.accent,fontWeight:500}}>{fmt(inv.total)} {inv.currency||'₺'}</td>
                        <td style={TD}><button onClick={()=>markUnpaid(inv)} style={{background:'none',border:`1px solid ${C.border}`,color:C.textMuted,borderRadius:6,padding:'4px 10px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:11}}>Geri Al</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* LIGHTBOX */}
      {lightbox&&(
        <div onClick={()=>setLightbox(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.94)',zIndex:1000,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,padding:24}}>
          <div onClick={e=>e.stopPropagation()}>
            <img src={lightbox.url} alt="fatura" style={{maxWidth:'90vw',maxHeight:'78vh',objectFit:'contain',borderRadius:8}}/>
          </div>
          <div onClick={e=>e.stopPropagation()} style={{display:'flex',gap:12}}>
            <button onClick={()=>downloadFromUrl(lightbox.url,lightbox.filename)} style={{background:C.accent,color:'#0f0f0f',border:'none',borderRadius:7,padding:'9px 20px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:500}}>⬇ İndir</button>
            <button onClick={()=>setLightbox(null)} style={{background:'none',border:`1px solid ${C.border}`,color:C.textMuted,borderRadius:7,padding:'9px 16px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:13}}>Kapat</button>
          </div>
          <div style={{color:C.textMuted,fontSize:11}}>{lightbox.filename}</div>
        </div>
      )}

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:4px}
        select option{background:#1a1a1a;color:#f0ece0}
      `}</style>
    </div>
  )
}