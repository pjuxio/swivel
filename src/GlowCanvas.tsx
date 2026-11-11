import { useEffect, useRef } from 'react'

type Orb = { x: number; y: number; r: number; rgb: string; speed: number; phase: number; drift: number }

// Positions and radii are fractions of the canvas so the layout scales with the window
const ORBS: Orb[] = [
  { x: 0.25, y: 0.3, r: 0.55, rgb: '139, 92, 246', speed: 0.11, phase: 0, drift: 0.08 },
  { x: 0.75, y: 0.25, r: 0.5, rgb: '34, 211, 238', speed: 0.09, phase: 2.1, drift: 0.07 },
  { x: 0.55, y: 0.75, r: 0.6, rgb: '99, 102, 241', speed: 0.07, phase: 4.2, drift: 0.09 },
  { x: 0.15, y: 0.8, r: 0.4, rgb: '34, 211, 238', speed: 0.13, phase: 5.5, drift: 0.06 },
]

export default function GlowCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let w = 0
    let h = 0
    let raf = 0
    // The pointer casts a faint light that eases toward the cursor
    const light = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const glow = (x: number, y: number, radius: number, rgb: string, alpha: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius)
      g.addColorStop(0, `rgba(${rgb}, ${alpha})`)
      g.addColorStop(1, `rgba(${rgb}, 0)`)
      ctx.fillStyle = g
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
    }

    const draw = (ms: number) => {
      const t = ms / 1000
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = '#0b0d14'
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      const size = Math.max(w, h)
      for (const o of ORBS) {
        const a = t * o.speed + o.phase
        const x = (o.x + Math.sin(a) * o.drift) * w
        const y = (o.y + Math.cos(a * 0.8) * o.drift) * h
        // Slow breathing between dim and bright
        const alpha = 0.09 + 0.08 * (0.5 + 0.5 * Math.sin(t * o.speed * 2.5 + o.phase))
        glow(x, y, o.r * size, o.rgb, alpha)
      }
      light.x += (light.tx - light.x) * 0.03
      light.y += (light.ty - light.y) * 0.03
      glow(light.x * w, light.y * h, 0.28 * size, '255, 255, 255', 0.04)
    }

    const frame = (ms: number) => {
      draw(ms)
      raf = requestAnimationFrame(frame)
    }

    const start = () => {
      cancelAnimationFrame(raf)
      if (reduced.matches) draw(0)
      else raf = requestAnimationFrame(frame)
    }

    const onMove = (e: PointerEvent) => {
      light.tx = e.clientX / window.innerWidth
      light.ty = e.clientY / window.innerHeight
    }

    const onResize = () => {
      resize()
      if (reduced.matches) draw(0)
    }

    resize()
    start()
    window.addEventListener('resize', onResize)
    window.addEventListener('pointermove', onMove)
    reduced.addEventListener('change', start)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
      reduced.removeEventListener('change', start)
    }
  }, [])

  return <canvas ref={ref} className="glow-canvas" aria-hidden="true" />
}
