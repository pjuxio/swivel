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
const PURPLES = ['#f2f0f7', '#dadaeb', '#bcbddc', '#9e9ac8', '#756bb1', '#54278f']
const BROWNS = ['#ffffd4', '#fee391', '#fec44f', '#fe9929', '#d95f0e', '#993404']

const scaleOf = (mins: number[], colors: string[]): [number, string][] => mins.map((m, i) => [m, colors[i]])
const pct = (v: number) => `${v.toFixed(1)}%`

type AcsField = 'hispanic' | 'asian' | 'aian' | 'foreign' | 'poverty' | 'broadband' | 'income'
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

type MobileRow = { name: string; g4: number | null; g4v: number | null; g5: number | null; g5v: number | null }

const mobileLayer = (field: 'g4' | 'g5', emoji: string, label: string, tech: string): ChoroplethConfig => ({
  id: `mobile_${field}`,
  emoji,
  label,
  source: 'FCC BDC',
  legendTitle: `% of county area with ${tech} coverage`,
  note: 'FCC Broadband Data Collection, mobile coverage (stationary). Share of land area, not population.',
  scale: scaleOf([0, 25, 50, 75, 90, 99], TEALS),
  format: pct,
  shapes: 'counties',
  load: async () => {
    const m = (await import('./data/mobile.json')).default as Record<string, MobileRow>
    return Object.fromEntries(
      Object.entries(m).map(([fips, r]) => [
        fips,
        {
          name: r.name,
          value: r[field],
          extra: r[`${field}v`] == null ? undefined : `In-vehicle: ${pct(r[`${field}v`]!)}`,
        },
      ]),
    )
  },
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
  acsLayer('broadband', '📶', 'Broadband internet access', '% households with a broadband subscription', scaleOf([0, 70, 80, 85, 90, 95], PURPLES)),
  mobileLayer('g4', '📡', 'Mobile 4G LTE coverage', '4G LTE'),
  mobileLayer('g5', '📲', 'Mobile 5G coverage', '5G-NR (35/3 Mbps)'),
  {
    id: 'hatecrime',
    emoji: '⚠️',
    label: 'Hate crimes',
    source: 'FBI 2020–24',
    legendTitle: 'Reported hate crimes per 100,000 per year',
    note: 'FBI Crime Data Explorer incidents 2020–2024, by police agency county. Reporting is voluntary, so low or missing counties may undercount. Gaps = no incidents reported.',
    scale: scaleOf([0, 1, 2.5, 5, 10, 20], REDS),
    format: (v) => v.toFixed(1),
    shapes: 'acs',
    load: async () => {
      type H = { name: string; incidents: number; rate: number }
      const h = (await import('./data/hatecrime.json')).default as Record<string, H>
      return Object.fromEntries(
        Object.entries(h).map(([fips, r]) => [
          fips,
          { name: r.name, value: r.rate, extra: `${r.incidents.toLocaleString('en-US')} incidents reported, 2020–24` },
        ]),
      )
    },
  },
  {
    id: 'pres_shift',
    emoji: '↔️',
    label: 'Presidential shift 2020 → 2024',
    source: 'County level',
    legendTitle: 'Change in margin (points)',
    note: 'Change in Republican-minus-Democratic margin from 2020 to 2024. Positive = shifted toward Republicans. Connecticut and Alaska are blank because their reporting areas changed.',
    scale: scaleOf([-1000, -10, -5, -2, 2, 5, 10], ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b']),
    format: (v) => `${v > 0 ? 'R +' : v < 0 ? 'D +' : ''}${Math.abs(v).toFixed(0)}`,
    shapes: 'counties',
    load: async () => {
      type P = { name: string; margin: number }
      const [a, b] = await Promise.all([import('./data/pres2020.json'), import('./data/pres2024.json')])
      const m20 = a.default as Record<string, P>
      const m24 = b.default as Record<string, P>
      const lean = (m: number) => `${m >= 0 ? 'R' : 'D'} +${Math.abs(m).toFixed(1)}`
      return Object.fromEntries(
        Object.entries(m24)
          .filter(([fips]) => m20[fips])
          .map(([fips, r]) => [
            fips,
            {
              name: r.name,
              value: r.margin - m20[fips].margin,
              extra: `2020: ${lean(m20[fips].margin)} → 2024: ${lean(r.margin)}`,
            },
          ]),
      )
    },
  },
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
    id: 'ej',
    emoji: '⚖️',
    label: 'Environmental justice',
    source: 'CDC EJI 2024',
    legendTitle: 'Environmental Justice Index (0–100)',
    note: 'CDC/ATSDR EJI 2024: cumulative environmental, social and health burden. Higher = greater burden. Tract percentiles averaged to counties, weighted by population.',
    scale: scaleOf([0, 20, 40, 55, 70, 85], PINKS),
    format: (v) => v.toFixed(0),
    shapes: 'acs',
    load: async () => {
      const ej = (await import('./data/ej.json')).default as Record<string, { name: string; score: number; tracts: number }>
      return Object.fromEntries(
        Object.entries(ej).map(([fips, r]) => [
          fips,
          { name: r.name, value: r.score * 100, extra: `${r.tracts} census tract${r.tracts === 1 ? '' : 's'}` },
        ]),
      )
    },
  },
  {
    id: 'lead',
    emoji: '🚰',
    label: 'Lead in drinking water',
    source: 'EPA SDWA / ECHO',
    legendTitle: 'Highest lead 90th percentile of a water system (ppb)',
    note: 'EPA Lead and Copper Rule results: each community water system\'s most recent 90th-percentile lead level, assigned to the counties it serves. EPA action level is 15 ppb. Data comes from state reporting and may contain errors.',
    scale: scaleOf([0, 5, 10, 15, 30, 60], ORANGES),
    format: (v) => `${v.toFixed(0)} ppb`,
    shapes: 'counties',
    load: async () => {
      type L = { name: string; max: number; systems: number; over: number; year: number }
      const l = (await import('./data/lead.json')).default as Record<string, L>
      return Object.fromEntries(
        Object.entries(l).map(([fips, r]) => [
          fips,
          {
            name: r.name,
            value: r.max,
            extra: `${r.systems} system${r.systems === 1 ? '' : 's'} · ${r.over} above the 15 ppb action level · latest result ${r.year}`,
          },
        ]),
      )
    },
  },
  {
    id: 'pfas',
    emoji: '💧',
    label: 'PFAS in drinking water (county)',
    source: 'EPA UCMR 5',
    legendTitle: 'Highest total PFAS in a water system (ppt)',
    note: 'EPA UCMR 5 (2023–2025) results. Each water system is assigned to the counties of the ZIP codes it serves, so locations are approximate. Gaps = no PFAS detected or not tested.',
    scale: scaleOf([0, 5, 10, 20, 40, 80], BLUES),
    format: (v) => `${v.toFixed(0)} ppt`,
    shapes: 'counties',
    load: async () => {
      type Pfas = { name: string; max: number; systems: number; over: number }
      const p = (await import('./data/pfas_county.json')).default as Record<string, Pfas>
      return Object.fromEntries(
        Object.entries(p).map(([fips, r]) => [
          fips,
          {
            name: r.name,
            value: r.max,
            extra: `${r.systems} system${r.systems === 1 ? '' : 's'} with PFAS · ${r.over} above the 4 ppt PFOA/PFOS limit`,
          },
        ]),
      )
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
