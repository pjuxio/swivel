export function fmtDist(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

export const fmtCount = (n: number) => n.toLocaleString('en-US')
