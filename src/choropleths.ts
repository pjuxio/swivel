export type Row = { name: string; value: number | null; extra?: string }

export interface ChoroplethConfig {
  id: string
  emoji: string
  label: string
  source: string
  legendTitle: string
  note: string
  // [minimum value, color] ascending; a county takes the highest step it reaches
  scale: [number, string][]
  format: (v: number) => string
  // 'acs' shapes use Connecticut planning regions; 'counties' use the old Connecticut counties
  shapes: 'acs' | 'counties'
  load: () => Promise<Record<string, Row>>
}

const BLUES = ['#eff3ff', '#c6dbef', '#9ecae1', '#6baed6', '#3182bd', '#08519c']
const ORANGES = ['#feedde', '#fdd0a2', '#fdae6b', '#fd8d3c', '#e6550d', '#a63603']
const TEALS = ['#edf8fb', '#ccece6', '#99d8c9', '#66c2a4', '#2ca25f', '#006d2c']
const GREENS = ['#f7fcb9', '#d9f0a3', '#addd8e', '#78c679', '#31a354', '#006837']
const PINKS = ['#feebe2', '#fcc5c0', '#fa9fb5', '#f768a1', '#c51b8a', '#7a0177']
const REDS = ['#fee5d9', '#fcbba1', '#fc9272', '#fb6a4a', '#de2d26', '#a50f15']
const BROWNS = ['#ffffd4', '#fee391', '#fec44f', '#fe9929', '#d95f0e', '#993404']

const scaleOf = (mins: number[], colors: string[]): [number, string][] => mins.map((m, i) => [m, colors[i]])
const pct = (v: number) => `${v.toFixed(1)}%`

type AcsField = 'hispanic' | 'asian' | 'aian' | 'foreign' | 'poverty' | 'income'
type AcsRow = { name: string } & Record<AcsField, number | null>

const loadAcs = (field: AcsField) => async () => {
  const acs = (await import('./data/acs.json')).default as Record<string, AcsRow>
  return Object.fromEntries(Object.entries(acs).map(([fips, r]) => [fips, { name: r.name, value: r[field] }]))
}

const acsLayer = (
  id: AcsField,
  emoji: string,
  label: string,
  legendTitle: string,
  scale: [number, string][],
  format = pct,
): ChoroplethConfig => ({
  id,
  emoji,
  label,
  source: 'Census ACS 2020–24',
  legendTitle,
  note: 'County level · ACS 2020–2024 5-year via Census Reporter',
  scale,
  format,
  shapes: 'acs',
  load: loadAcs(id),
})

export const CHOROPLETHS: ChoroplethConfig[] = [
  acsLayer('hispanic', '🟧', 'Hispanic / Latino population', '% Hispanic / Latino', scaleOf([0, 5, 10, 20, 40, 60], ORANGES)),
  acsLayer('asian', '🟩', 'Asian population', '% Asian', scaleOf([0, 1, 2, 5, 10, 20], TEALS)),
  acsLayer('aian', '🟫', 'Native American population', '% American Indian / Alaska Native', scaleOf([0, 1, 2, 5, 15, 40], GREENS)),
  acsLayer('foreign', '🌍', 'Foreign-born residents', '% foreign-born', scaleOf([0, 3, 6, 10, 15, 25], PINKS)),
  acsLayer('poverty', '📉', 'Poverty rate', '% below poverty line', scaleOf([0, 8, 12, 16, 22, 30], REDS)),
  acsLayer(
    'income',
    '💵',
    'Median household income',
    'Median household income',
    scaleOf([0, 45000, 60000, 75000, 95000, 125000], BLUES),
    (v) => `$${Math.round(v).toLocaleString('en-US')}`,
  ),
  {
    id: 'life',
    emoji: '⏳',
    label: 'Life expectancy',
    source: 'CHR 2025',
    legendTitle: 'Life expectancy at birth (years)',
    note: 'County Health Rankings 2025 release (multi-year estimates).',
    scale: scaleOf([0, 70, 73, 76, 79, 82], GREENS),
    format: (v) => `${v.toFixed(1)} yrs`,
    shapes: 'counties',
    load: async () => {
      const life = (await import('./data/life.json')).default as Record<string, { name: string; years: number }>
      return Object.fromEntries(Object.entries(life).map(([fips, r]) => [fips, { name: r.name, value: r.years }]))
    },
  },
  {
    id: 'aqi',
    emoji: '🌫️',
    label: 'Air quality',
    source: 'EPA AQI 2024',
    legendTitle: '% of days with AQI above "Good"',
    note: 'EPA annual AQI by county. Only counties with an EPA monitor are shaded.',
    scale: scaleOf([0, 10, 25, 40, 60, 80], BROWNS),
    format: pct,
    shapes: 'counties',
    load: async () => {
      type Aqi = { name: string; median: number; pctNotGood: number | null; unhealthy: number; days: number; year: number }
      const aqi = (await import('./data/aqi.json')).default as Record<string, Aqi>
      return Object.fromEntries(
        Object.entries(aqi).map(([fips, r]) => [
          fips,
          {
            name: r.name,
            value: r.pctNotGood,
            extra: `Median AQI ${r.median} · ${r.unhealthy} unhealthy day${r.unhealthy === 1 ? '' : 's'} of ${r.days} (${r.year})`,
          },
        ]),
      )
    },
  },
]
