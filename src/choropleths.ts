import type { LayerGroup } from './amenities'

export type Row = { name: string; value: number | null; extra?: string }

export interface ChoroplethConfig {
  id: string
  group: LayerGroup
  emoji: string
  label: string
  source: string
  legendTitle: string
  note: string
  // [minimum value, color] ascending; a county takes the highest step it reaches
  scale: [number, string][]
  // Legend text per scale step (ascending); defaults to ranges built with `format`
  labels?: string[]
  format: (v: number) => string
  // Tooltip line for a county's value; defaults to "<label>: <formatted value>"
  describe?: (v: number) => string
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
const NO_PR = 'Puerto Rico is not covered.'

export const colorOf = (cfg: ChoroplethConfig, v: number | null | undefined) =>
  v == null ? 'transparent' : [...cfg.scale].reverse().find(([min]) => v >= min)![1]

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
  group: 'demographics',
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
  group: 'tech',
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

type PresYear = 2016 | 2020 | 2024
type PresRow = { name: string; gop: number; dem: number; total: number; margin: number }

const PRES_DEM: Record<PresYear, string> = { 2016: 'Clinton', 2020: 'Biden', 2024: 'Harris' }
const PRES_DATA: Record<PresYear, () => Promise<{ default: unknown }>> = {
  2016: () => import('./data/pres2016.json'),
  2020: () => import('./data/pres2020.json'),
  2024: () => import('./data/pres2024.json'),
}
const PRES_NOTES: Record<PresYear, string> = {
  2016: 'County level · margin of victory. Puerto Rico has no presidential vote.',
  2020: 'County level · margin of victory. Alaska is blank: it reports by state house district, not borough. Puerto Rico has no presidential vote.',
  2024: 'County level · margin of victory · Connecticut by planning region. Alaska is blank: it reports by state house district, not borough. Puerto Rico has no presidential vote.',
}

// Positive margin = Republican lead, negative = Democratic lead
const presidentialLayer = (year: PresYear): ChoroplethConfig => {
  const fmt = (n: number) => n.toLocaleString('en-US')
  return {
    id: `pres${year}`,
    group: 'social',
    emoji: '🗳️',
    label: `${year} presidential results`,
    source: 'County level',
    legendTitle: `${year} presidential result`,
    note: PRES_NOTES[year],
    scale: scaleOf([-1000, -40, -20, -5, 5, 20, 40], ['#08306b', '#2171b5', '#6baed6', '#d9d9e8', '#fb6a4a', '#de2d26', '#99000d']),
    labels: ['D +40 or more', 'D +20 to 40', 'D +5 to 20', 'Within 5 points', 'R +5 to 20', 'R +20 to 40', 'R +40 or more'],
    format: (v) => `${v >= 0 ? 'R' : 'D'} +${Math.abs(v).toFixed(1)}`,
    describe: (v) => `${v >= 0 ? 'Trump (R)' : `${PRES_DEM[year]} (D)`} +${Math.abs(v).toFixed(1)}`,
    shapes: year === 2024 ? 'acs' : 'counties',
    load: async () => {
      const rows = (await PRES_DATA[year]()).default as Record<string, PresRow>
      return Object.fromEntries(
        Object.entries(rows).map(([fips, r]) => [
          fips,
          { name: r.name, value: r.margin, extra: `Trump ${fmt(r.gop)} · ${PRES_DEM[year]} ${fmt(r.dem)}` },
        ]),
      )
    },
  }
}

export const CHOROPLETHS: ChoroplethConfig[] = [
  presidentialLayer(2024),
  presidentialLayer(2020),
  presidentialLayer(2016),
  {
    id: 'blackpop',
    group: 'demographics',
    emoji: '🟪',
    label: 'Black / African American population',
    source: 'Census ACS 2020–24',
    legendTitle: '% Black / African American',
    note: 'County level · ACS 2020–2024 5-year via Census Reporter',
    scale: scaleOf([0, 2, 10, 20, 35, 55], ['#fcfbfd', '#efedf5', '#bcbddc', '#9e9ac8', '#756bb1', '#54278f']),
    format: pct,
    shapes: 'acs',
    load: async () => {
      const b = (await import('./data/blackpop.json')).default as Record<string, { name: string; pct: number }>
      return Object.fromEntries(Object.entries(b).map(([fips, r]) => [fips, { name: r.name, value: r.pct }]))
    },
  },
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
    group: 'public_safety',
    emoji: '⚠️',
    label: 'Hate crimes',
    source: 'FBI 2020–24',
    legendTitle: 'Reported hate crimes per 100,000 per year',
    note: 'FBI Crime Data Explorer incidents 2020–2024, by police agency county. Reporting is voluntary, so low or missing counties may undercount. Gaps = no incidents reported. Alaska and Puerto Rico are not covered.',
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
    group: 'social',
    emoji: '↔️',
    label: 'Presidential shift 2020 → 2024',
    source: 'County level',
    legendTitle: 'Change in margin (points)',
    note: 'Change in Republican-minus-Democratic margin from 2020 to 2024. Positive = shifted toward Republicans. Connecticut and Alaska are blank because their reporting areas changed. Puerto Rico has no presidential vote.',
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
    group: 'demographics',
    emoji: '⏳',
    label: 'Life expectancy',
    source: 'CHR 2025',
    legendTitle: 'Life expectancy at birth (years)',
    note: `County Health Rankings 2025 release (multi-year estimates). ${NO_PR}`,
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
    group: 'environmental',
    emoji: '⚖️',
    label: 'Environmental justice',
    source: 'CDC EJI 2024',
    legendTitle: 'Environmental Justice Index (0–100)',
    note: 'CDC/ATSDR EJI 2024: cumulative environmental, social and health burden. Higher = greater burden. Tract percentiles averaged to counties, weighted by population. Alaska and Puerto Rico are not covered.',
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
    group: 'environmental',
    emoji: '🚰',
    label: 'Lead in drinking water',
    source: 'EPA SDWA / ECHO',
    legendTitle: 'Highest lead 90th percentile of a water system (ppb)',
    note: 'EPA Lead and Copper Rule results: each community water system\'s most recent 90th-percentile lead level, assigned to the counties it serves. EPA action level is 15 ppb. Data comes from state reporting and may contain errors. Virginia\'s independent cities and Puerto Rico are blank.',
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
    group: 'environmental',
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
    group: 'environmental',
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
  {
    id: 'violentcrime',
    group: 'public_safety',
    emoji: '🚨',
    label: 'Violent crime rate',
    source: 'CHR 2022 · older data',
    legendTitle: 'Violent crime per 100,000',
    note: `Older data: County Health Rankings 2022 release (underlying FBI figures are from years earlier). Gaps = counties with no reported data. ${NO_PR}`,
    scale: scaleOf([0, 75, 150, 250, 400, 600], ['#fed976', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026']),
    format: (v) => v.toLocaleString('en-US'),
    describe: (v) => `Violent crime: ${v.toLocaleString('en-US')} per 100k`,
    shapes: 'counties',
    load: async () => {
      const rates = (await import('./data/violentcrime.json')).default as Record<string, { name: string; rate: number }>
      return Object.fromEntries(
        Object.entries(rates).map(([fips, r]) => [fips, { name: r.name, value: r.rate, extra: 'Older data (CHR 2022)' }]),
      )
    },
  },
]
