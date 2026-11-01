import type { ReactNode } from 'react'

/**
 * Dataset descriptions and credits shown in the info overlay. This is app
 * content, deliberately kept out of the generated data manifests: the
 * subhead's one-line citation still comes from manifest.json, while the full
 * story and the attribution for the original experiments live here.
 *
 * References with `verify: true` were drafted from web research and render a
 * "verify" badge until confirmed; remove the flag once checked.
 */

export interface DatasetReference {
  authors: string
  year: number
  title: string
  /** journal or repository */
  source: string
  /** volume/pages, e.g. "v. 250, 104706" */
  pages?: string
  /** bare DOI, rendered as a https://doi.org link */
  doi?: string
  /** fallback when there is no DOI */
  url?: string
  /** drafted from web research; awaiting confirmation */
  verify?: boolean
}

export interface DatasetCredit {
  id: 'barrell' | 'wheeler1964' | 'xes02' | 'tdwb17' | 'meanderpy'
  /** display name, matches the dataset picker */
  title: string
  summary: ReactNode
  /** where the data comes from (facility, publication, model) */
  origin: string
  /** who to credit */
  credit: string
  references: DatasetReference[]
  links: { label: string; href: string }[]
}

/** The paper this whole app is built around; every dataset cites it. */
const PAPER_2024: DatasetReference = {
  authors: 'Sylvester, Z., Straub, K.M. & Covault, J.A.',
  year: 2024,
  title: 'Stratigraphy in space and time: a reproducible approach to analysis and visualization',
  source: 'Earth-Science Reviews',
  pages: 'v. 250, 104706',
  doi: '10.1016/j.earscirev.2024.104706',
}

export const datasetCredits: DatasetCredit[] = [
  {
    id: 'barrell',
    title: 'Barrell 1917',
    summary: (
      <>
        Joseph Barrell&rsquo;s hypothetical curve of sediment-surface elevation through
        time — the figure that first showed why most of geologic time is missing from the
        rock record. The curve and the stratigraphic column it generates were digitized
        from Figure 5 of the 1917 paper; the original scan can be shown behind the
        reconstruction in the Barrell plot.
      </>
    ),
    origin: 'Digitized from Barrell (1917), Fig. 5.',
    credit: 'Joseph Barrell; digitization by Sylvester, Straub & Covault (2024).',
    references: [
      {
        authors: 'Barrell, J.',
        year: 1917,
        title: 'Rhythms and the measurement of geologic time',
        source: 'Geological Society of America Bulletin',
        pages: 'v. 28, p. 745–904',
        doi: '10.1130/GSAB-28-745',
      },
      PAPER_2024,
    ],
    links: [],
  },
  {
    id: 'wheeler1964',
    title: 'Wheeler 1964',
    summary: (
      <>
        Harry Wheeler&rsquo;s baselevel-transit example: topographic surfaces digitized
        from his 1964 figure, with a reconstructed basement-uplift history, so that his
        time-stratigraphic (&ldquo;Wheeler&rdquo;) diagram can be rebuilt — and animated —
        from the surfaces themselves.
      </>
    ),
    origin: 'Digitized from Wheeler (1964); uplift history reconstructed.',
    credit: 'Harry E. Wheeler; digitization and reconstruction by Sylvester, Straub & Covault (2024).',
    references: [
      {
        authors: 'Wheeler, H.E.',
        year: 1964,
        title: 'Baselevel, lithosphere surface, and time-stratigraphy',
        source: 'Geological Society of America Bulletin',
        pages: 'v. 75, p. 599–610',
        doi: '10.1130/0016-7606(1964)75[599:BLSAT]2.0.CO;2',
      },
      PAPER_2024,
    ],
    links: [],
  },
  {
    id: 'xes02',
    title: 'XES-02',
    summary: (
      <>
        The XES-02 run of the eXperimental EarthScape facility (the &ldquo;Jurassic
        tank&rdquo;): a sandbox delta built over a subsiding floor, with slow and rapid
        base-level cycles. Topography and basement scans were resampled to one-hour time
        steps; the overhead photos can be draped on the 3D block and shown in map view.
      </>
    ),
    origin:
      'Physical experiment at St. Anthony Falls Laboratory, University of Minnesota (2002).',
    credit:
      'The XES-02 experimental team at SAFL, University of Minnesota (C. Paola, N. Strong, J. Martin, W. Kim, A. Cantelli, J. Mullin, and colleagues); data processing by Sylvester, Straub & Covault (2024).',
    references: [
      {
        authors: 'Martin, J., Paola, C., Abreu, V., Neal, J. & Sheets, B.',
        year: 2009,
        title:
          'Sequence stratigraphy of experimental strata under known conditions of differential subsidence and variable base level',
        source: 'AAPG Bulletin',
        pages: 'v. 93, p. 503–533',
        doi: '10.1306/12110808057',
      },
      {
        authors: 'Strong, N. & Paola, C.',
        year: 2008,
        title: 'Valleys that never were: time surfaces versus stratigraphic surfaces',
        source: 'Journal of Sedimentary Research',
        pages: 'v. 78, p. 579–593',
        doi: '10.2110/jsr.2008.059',
      },
      {
        authors: 'Kim, W., Paola, C., Voller, V.R. & Swenson, J.B.',
        year: 2006,
        title: 'Experimental measurement of the relative importance of controls on shoreline migration',
        source: 'Journal of Sedimentary Research',
        pages: 'v. 76, p. 270–283',
        doi: '10.2110/jsr.2006.019',
      },
      PAPER_2024,
    ],
    links: [
      { label: 'XES Basin data (NCED)', href: 'https://nced.umn.edu/node/231' },
    ],
  },
  {
    id: 'tdwb17',
    title: 'TDWB-17-1',
    summary: (
      <>
        A delta built in the Tulane Delta Basin under steadily rising base level, scanned
        101 times over 12.5 days of run time. The scans were downsampled to a 10 mm grid
        for this app.
      </>
    ),
    origin: 'Physical experiment in the Tulane Sediment Dynamics Laboratory (Straub lab), Tulane University (2017).',
    credit: 'Kyle M. Straub and the Tulane Sediment Dynamics Laboratory; data processing by Sylvester, Straub & Covault (2024).',
    references: [
      {
        authors: 'Straub, K.M.',
        year: 2019,
        title:
          'Morphodynamics and stratigraphic architecture of shelf-edge deltas subject to constant vs. dynamic environmental forcings: a laboratory study',
        source: 'Frontiers in Earth Science',
        pages: 'v. 7, article 121',
        doi: '10.3389/feart.2019.00121',
      },
      PAPER_2024,
    ],
    links: [
      {
        label: 'TDWB_17_1 data (SEAD)',
        href: 'https://sead2.ncsa.illinois.edu/datasets/5d5c54c8e4b0a0716e3f0f11',
      },
    ],
  },
  {
    id: 'meanderpy',
    title: 'meanderpy',
    summary: (
      <>
        A numerical meandering-river model built with meanderpy: 60 channel-migration
        events, each followed by point-bar and levee deposition, on a 30 m grid. Unlike
        the experiments, every surface is known exactly — a clean testbed for the
        space-time ideas.
      </>
    ),
    origin: 'Numerical model (meanderpy, open-source Python).',
    credit: 'Model and code by Zoltán Sylvester.',
    references: [
      {
        authors: 'Sylvester, Z., Durkin, P. & Covault, J.A.',
        year: 2019,
        title: 'High curvatures drive river meandering',
        source: 'Geology',
        pages: 'v. 47, p. 263–266',
        doi: '10.1130/G45608.1',
      },
      PAPER_2024,
    ],
    links: [{ label: 'meanderpy on GitHub', href: 'https://github.com/zsylvester/meanderpy' }],
  },
]
