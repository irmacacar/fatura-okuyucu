import { useState } from 'react'
import { supabase } from './supabase'

const C = {
  bg:"#0f0f0f", surface:"#1a1a1a", border:"#2a2a2a",
  accent:"#e8d5a3", text:"#f0ece0", textMuted:"#7a7670",
  error:"#e05c5c", success:"#4caf7d",
}

export default function Login() {
  const [mode, setMode]       = useState('login')   // 'login' | 'signup'
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]         = useState(null)       // { type: 'error'|'success', text }

  const handle = async (e) => {
    e.preventDefault()
    setLoading(true); setMsg(null)

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setMsg({ type: 'error', text: 'E-posta veya şifre hatalı.' })
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setMsg({ type: 'error', text: error.message })
      else setMsg({ type: 'success', text: 'Hesap oluşturuldu. Giriş yapabilirsiniz.' })
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'DM Mono',monospace" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700&display=swap" rel="stylesheet"/>

      <div style={{ width:'100%', maxWidth:380, padding:'0 24px' }}>
        {/* Logo */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:40 }}>
          <div style={{ width:32, height:32, background:C.accent, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>◈</div>
          <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:17, color:C.text, letterSpacing:'0.02em' }}>FaturaOku</span>
        </div>

        {/* Card */}
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:'28px 28px 24px' }}>
          <div style={{ color:C.text, fontWeight:500, fontSize:15, marginBottom:24 }}>
            {mode === 'login' ? 'Giriş Yap' : 'Hesap Oluştur'}
          </div>

          <form onSubmit={handle} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div>
              <label style={{ color:C.textMuted, fontSize:11, display:'block', marginBottom:6 }}>E-posta</label>
              <input
                type="email" required value={email} onChange={e=>setEmail(e.target.value)}
                placeholder="ornek@email.com"
                style={{ width:'100%', background:'#111', color:C.text, border:`1px solid ${C.border}`, borderRadius:7, padding:'9px 12px', fontFamily:"'DM Mono',monospace", fontSize:13, outline:'none' }}
              />
            </div>
            <div>
              <label style={{ color:C.textMuted, fontSize:11, display:'block', marginBottom:6 }}>Şifre</label>
              <input
                type="password" required value={password} onChange={e=>setPassword(e.target.value)}
                placeholder="••••••••"
                style={{ width:'100%', background:'#111', color:C.text, border:`1px solid ${C.border}`, borderRadius:7, padding:'9px 12px', fontFamily:"'DM Mono',monospace", fontSize:13, outline:'none' }}
              />
            </div>

            {msg && (
              <div style={{ padding:'8px 12px', borderRadius:6, background:msg.type==='error'?`${C.error}18`:`${C.success}18`, color:msg.type==='error'?C.error:C.success, fontSize:12 }}>
                {msg.text}
              </div>
            )}

            <button type="submit" disabled={loading} style={{ background:C.accent, color:'#0f0f0f', border:'none', borderRadius:7, padding:'10px', cursor:loading?'default':'pointer', fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:500, marginTop:4, opacity:loading?0.7:1 }}>
              {loading ? '...' : mode === 'login' ? 'Giriş Yap' : 'Hesap Oluştur'}
            </button>
          </form>

          <div style={{ marginTop:20, textAlign:'center', fontSize:12, color:C.textMuted }}>
            {mode === 'login' ? (
              <>Hesabın yok mu?{' '}
                <button onClick={()=>{setMode('signup');setMsg(null)}} style={{ background:'none', border:'none', color:C.accent, cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:12 }}>Oluştur</button>
              </>
            ) : (
              <>Zaten hesabın var mı?{' '}
                <button onClick={()=>{setMode('login');setMsg(null)}} style={{ background:'none', border:'none', color:C.accent, cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:12 }}>Giriş yap</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
