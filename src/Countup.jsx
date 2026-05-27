import { useEffect, useRef, useState, useCallback } from 'react'

const TARGET_MS = 9991

const C = {
  bg:'#0f0f0f', surface:'#1a1a1a', surfaceAlt:'#212121',
  border:'#2a2a2a', accent:'#e8d5a3', accentDim:'#b5a47e',
  text:'#f0ece0', textMuted:'#7a7670', textDim:'#3a3630',
}

export default function Countup() {
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const startTsRef = useRef(null)
  const rafRef = useRef(null)
  const elapsedRef = useRef(0)

  const finished = elapsed >= TARGET_MS

  const stopRaf = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  const tick = useCallback((now) => {
    const delta = now - startTsRef.current
    if (delta >= TARGET_MS) {
      elapsedRef.current = TARGET_MS
      setElapsed(TARGET_MS)
      setRunning(false)
      rafRef.current = null
      return
    }
    elapsedRef.current = delta
    setElapsed(delta)
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const start = useCallback(() => {
    if (elapsedRef.current >= TARGET_MS) return
    startTsRef.current = performance.now() - elapsedRef.current
    setRunning(true)
    rafRef.current = requestAnimationFrame(tick)
  }, [tick])

  const pause = useCallback(() => {
    stopRaf()
    setRunning(false)
  }, [])

  const reset = useCallback(() => {
    stopRaf()
    elapsedRef.current = 0
    startTsRef.current = null
    setElapsed(0)
    setRunning(false)
  }, [])

  useEffect(() => () => stopRaf(), [])

  const pct = Math.min(100, (elapsed / TARGET_MS) * 100)
  const seconds = (Math.min(elapsed, TARGET_MS) / 1000).toFixed(3)
  const status = finished ? 'Bitti' : running ? 'Çalışıyor' : elapsed > 0 ? 'Duraklatıldı' : 'Hazır'
  const primaryLabel = finished ? 'Başla' : running ? 'Duraklat' : elapsed > 0 ? 'Devam' : 'Başla'

  return (
    <div style={{height:'100%',display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
      <div style={{width:'100%',maxWidth:560,background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:'32px 30px'}}>
        <div style={{fontSize:11,fontWeight:500,letterSpacing:'0.14em',color:C.textMuted,textTransform:'uppercase',marginBottom:22}}>
          Sayaç · Count Up
        </div>

        <div style={{display:'flex',alignItems:'baseline',gap:10,marginBottom:18}}>
          <span style={{fontSize:58,fontWeight:500,color:C.accent,fontVariantNumeric:'tabular-nums',lineHeight:1}}>{seconds}</span>
          <span style={{color:C.textMuted,fontSize:16,fontVariantNumeric:'tabular-nums'}}>/ 9.991 s</span>
        </div>

        <div style={{position:'relative',height:14,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:7,overflow:'hidden',marginBottom:22}}>
          <div style={{
            position:'absolute',top:0,left:0,bottom:0,
            width:`${pct}%`,
            background:`linear-gradient(90deg, ${C.accentDim}, ${C.accent})`,
            borderRadius:'7px 0 0 7px',
            transition:'width 60ms linear',
          }}/>
        </div>

        <div style={{display:'flex',gap:10}}>
          <button
            onClick={running ? pause : start}
            disabled={finished}
            style={{
              flex:1,
              background:finished ? 'transparent' : C.accent,
              color:finished ? C.textDim : '#0f0f0f',
              border:`1px solid ${finished ? C.border : C.accent}`,
              borderRadius:8,padding:'10px 14px',
              cursor:finished ? 'default' : 'pointer',
              fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,letterSpacing:'0.04em',
            }}
          >
            {primaryLabel}
          </button>
          <button
            onClick={reset}
            disabled={elapsed === 0 && !running}
            style={{
              flex:1,
              background:'transparent',
              color:elapsed === 0 && !running ? C.textDim : C.text,
              border:`1px solid ${C.border}`,
              borderRadius:8,padding:'10px 14px',
              cursor:elapsed === 0 && !running ? 'default' : 'pointer',
              fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:500,letterSpacing:'0.04em',
            }}
          >
            Sıfırla
          </button>
        </div>

        <div style={{marginTop:18,display:'flex',justifyContent:'space-between',color:C.textMuted,fontSize:11}}>
          <span>{status}</span>
          <span>%{pct.toFixed(1)}</span>
        </div>
      </div>
    </div>
  )
}
