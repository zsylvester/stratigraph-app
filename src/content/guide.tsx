import type { ReactNode } from 'react'

/**
 * User-guide content, kept as data so the Guide tab renders scannable
 * action/input tables instead of prose. Inputs render as <kbd>-style chips;
 * `ui:` chips name an on-screen control rather than a key or gesture.
 */

export interface GuideRow {
  action: string
  /** keys, gestures, or `ui:`-prefixed on-screen controls */
  input: string[]
  note?: string
}

export interface GuideSection {
  id: string
  title: string
  body?: ReactNode
  rows: GuideRow[]
}

export const guideSections: GuideSection[] = [
  {
    id: 'time',
    title: 'One time step drives everything',
    body: (
      <>
        Every panel shows the same moment in the history of the landscape: the map and 3D
        block show the surface at that time, the cross section and Barrell plot show the
        stratigraphy accumulated up to it, and the chronostratigraphic diagram grows with
        it. The timeline bar at the bottom controls that shared time step. The curve
        behind the scrubber is the dataset&rsquo;s driving signal (sea level for the
        experiments, elevation or mean elevation for the others).
      </>
    ),
    rows: [
      { action: 'play / pause', input: ['space', 'ui:▶'], note: 'play at the end restarts from the beginning' },
      { action: 'step one time step', input: ['←', '→'] },
      { action: 'jump 10 steps', input: ['shift + ←/→'] },
      { action: 'scrub to any time', input: ['click', 'drag'], note: 'on the timeline strip' },
      { action: 'playback speed', input: ['ui:10 | 30 | 60'], note: 'time steps per second' },
    ],
  },
  {
    id: 'map',
    title: '01 · Map view',
    body: (
      <>
        A plan view of the evolving surface (3D-grid datasets only). It also shows where
        the cross section (solid line) and the probe (circle) sit, so it is the easiest
        place to choose what the other panels slice.
      </>
    ),
    rows: [
      { action: 'move the cross section', input: ['click', 'drag'], note: 'anywhere on the map' },
      { action: 'choose the map field', input: ['ui:topography | thickness | photo'], note: 'photo = overhead camera, XES-02 only; thickness = deposit accumulated up to the current time' },
      { action: 'switch to the 3D block', input: ['ui:map | 3D'] },
    ],
  },
  {
    id: 'block3d',
    title: '01 · 3D block',
    body: (
      <>
        The full stratigraphic volume as a block diagram, with the current topography on
        top. The cut modes slice it along the same plane as the cross-section panel, so
        the two always agree.
      </>
    ),
    rows: [
      { action: 'orbit', input: ['drag'] },
      { action: 'zoom', input: ['wheel', 'pinch'] },
      { action: 'pan', input: ['right-drag'] },
      { action: 'slice the block', input: ['ui:block | 2×2 | 3×3 | dip cut | strike cut'], note: '2×2 / 3×3 explode the block into slices (gap slider); the cut modes expose one moving face' },
      { action: 'move the cut plane', input: ['ui:cut slider'], note: 'the cross-section panel follows; “other side” flips the kept half' },
      { action: 'color the deposits', input: ['ui:age | facies'] },
      { action: 'drape the top surface', input: ['ui:elev | photo'], note: 'XES-02 only: overhead photos on the topography' },
      { action: 'highlight erosion', input: ['ui:erosion'], note: 'erosional surfaces in red on the exposed sections' },
      { action: 'vertical exaggeration', input: ['ui:v.e. slider'] },
      { action: 'reset the camera', input: ['ui:reset view'] },
    ],
  },
  {
    id: 'section',
    title: '02 · Cross section',
    body: (
      <>
        The preserved stratigraphy along the section line, layer by layer, up to the
        current time step. Gray is basement; the dashed line is sea level. The probe
        (vertical line) is where the Barrell plot reads its elevation history.
      </>
    ),
    rows: [
      { action: 'move the probe', input: ['click'] },
      { action: 'pick the section', input: ['ui:dip | strike', 'ui:position slider'], note: '3D-grid datasets; or click/drag the map' },
      { action: 'color layers', input: ['ui:age | facies'] },
      { action: 'show erosional surfaces', input: ['ui:erosion'], note: 'in red' },
      { action: 'aspect ratio', input: ['ui:fit | 1:1'], note: 'stretch to the panel, or equal horizontal/vertical scale' },
      { action: 'zoom', input: ['wheel', 'pinch', 'ui:box zoom'], note: 'box zoom: drag a rectangle; the Wheeler diagram follows the horizontal zoom' },
      { action: 'pan', input: ['drag'] },
      { action: 'reset zoom', input: ['double-click', 'ui:reset'] },
    ],
  },
  {
    id: 'barrell',
    title: '03 · Barrell plot',
    body: (
      <>
        The elevation history at the probe location — Joseph Barrell&rsquo;s 1917 way of
        explaining why so little time is preserved as rock. Rising segments are
        deposition, falling are erosion, flat are stasis. The jagged line below the curve
        is what survives; the column on the right is the resulting stratigraphy, and the
        readouts give the share of time spent in deposition, erosion, vacuity, and
        stasis.
      </>
    ),
    rows: [
      { action: 'move the probe', input: ['ui:location slider'], note: 'or click in the cross section / map' },
      { action: 'show the 1917 original', input: ['ui:1917 scan'], note: 'Barrell dataset only: the published figure behind the curve' },
    ],
  },
  {
    id: 'wheeler',
    title: '04 · Chronostratigraphic diagram',
    body: (
      <>
        The Wheeler diagram: distance along the section on the x-axis, time on the
        y-axis. Blue is deposition that survives, red is erosion, and white is time with
        no rock record — stasis or vacuity. It grows upward as time advances, and shares
        its distance axis (and zoom) with the cross section above it.
      </>
    ),
    rows: [
      { action: 'set time and probe at once', input: ['click'] },
      { action: 'inspect a point', input: ['hover'], note: 'crosshair echoes in the other panels' },
    ],
  },
  {
    id: 'linking',
    title: 'Linked views',
    body: (
      <>
        The panels are one instrument: the section line, probe, time step, colors, and
        horizontal zoom are shared, and hovering any plot draws ghost markers at the same
        place in the others.
      </>
    ),
    rows: [
      { action: 'maximize a panel', input: ['ui:⤢'], note: 'button in the panel header' },
      { action: 'restore the grid', input: ['esc', 'ui:⤡'] },
    ],
  },
  {
    id: 'sharing',
    title: 'Sharing a view',
    body: (
      <>
        The URL always encodes the current dataset, time step, section, probe, and color
        mode (and this guide, when open). Copy it from the address bar to share exactly
        what you see.
      </>
    ),
    rows: [],
  },
]
