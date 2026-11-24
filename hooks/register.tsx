import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import type { Game } from '../types'
import { makeColors } from './make-colors.js'

const PANE = 'thanksgiving-den'
const TITLE = 'Thanksgiving'
const SCENE = 'thanksgiving-den'

const percentAtom = atom({ plugin: 'thanksgiving', key: 'percent' } as const, 0)
const frameAtom = atom({ plugin: 'thanksgiving', key: 'frame' } as const, 0)
const FRESH_GAME: Game = { home: 0, away: 0, scrimmage: 5, offenseHome: true }
const gameAtom = atom({ plugin: 'thanksgiving', key: 'game' } as const, FRESH_GAME, {
  shape: 'game-1',
})

// ─── The feast ──────────────────────────────────────────────────────────────
// Laid out on the table in this order; eaten in EAT_ORDER, turkey and pie last.
const DISHES = [
  '🥖', '🌽', '🥔', '🍠', '🥗', '🍗', '🦃', '🍗', '🥧', '🍎', '🧀', '🍷',
  '🥕', '🍄', '🥦', '🍞', '🍇', '🍐', '🥜', '🍰', '🧈', '🍯', '🍪', '🍮',
] as const
const EAT_ORDER = [
  14, 12, 4, 17, 13, 18, 2, 3, 1, 15, 0, 22, 16, 9, 10, 20, 21, 11, 23, 19, 5, 7, 8, 6,
]

function eatenSet(percent: number, total: number, order: number[]): Set<number> {
  const count = Math.min(total, Math.round((total * percent) / 100))
  return new Set(order.slice(0, count))
}

function mood(percent: number): string {
  if (percent < 1) return 'Dinner is served. The table groans under the feast!'
  if (percent < 25) return 'Plates are piled high. Dig in!'
  if (percent < 50) return 'Seconds, anyone? Pass the gravy.'
  if (percent < 75) return 'Loosening the belt a notch...'
  if (percent < 90) return 'Just a sliver more pie...'
  if (percent < 100) return 'Food coma imminent 😴  /compact for leftovers'
  return 'Not a crumb left. Time for a nap on the couch.'
}

// ─── Terminal drawing helpers ───────────────────────────────────────────────
type Seg = [string, string?]

function hash(a: number, b: number, c: number): number {
  let n = (a * 374761393 + b * 668265263 + c * 2147483647) | 0
  n = (n ^ (n >>> 13)) * 1274126177
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

const FLAME_ROWS: { chars: string; color: string; spread: number }[] = [
  { chars: " .'`*", color: '#ffd166', spread: 0.35 },
  { chars: '()^*)', color: '#ff9f1c', spread: 0.6 },
  { chars: '(W)M^', color: '#e85d04', spread: 0.95 },
]

function flameRow(row: number, frame: number, width: number): Seg[] {
  const { chars, color, spread } = FLAME_ROWS[row] ?? FLAME_ROWS[0]!
  const segs: Seg[] = []
  for (let x = 0; x < width; x++) {
    const fromCenter = Math.abs(x - (width - 1) / 2) / (width / 2)
    const r = hash(frame, x, row)
    if (fromCenter > spread || r < 0.25 + fromCenter * 0.4) {
      segs.push([' '])
    } else {
      const ch = chars[Math.floor(hash(frame + 7, x, row) * chars.length)] ?? ' '
      segs.push([ch, r > 0.85 ? '#fff3b0' : color])
    }
  }

  return segs
}

const FIELD_W = 26

function fieldRows(game: Game, frame: number): Seg[][] {
  const step = frame % 12
  const d = game.offenseHome ? 1 : -1
  const toX = (s: number) => (game.offenseHome ? s : FIELD_W - 1 - s)
  const clamp = (x: number) => Math.max(0, Math.min(FIELD_W - 1, x))
  const los = toX(game.scrimmage)
  const run = step < 3 ? 0 : Math.floor((step - 2) * 0.7)
  const carrier = clamp(los - 2 * d + run * d)

  const put = (row: (Seg | null)[], x: number, seg: Seg) => {
    row[clamp(x)] = seg
  }
  const top: (Seg | null)[] = Array(FIELD_W).fill(null)
  const mid: (Seg | null)[] = Array(FIELD_W).fill(null)
  const bot: (Seg | null)[] = Array(FIELD_W).fill(null)
  const rows = [top, mid, bot]
  const home = '#ffb703'
  const away = '#caf0f8'
  const off = game.offenseHome ? home : away
  const def = game.offenseHome ? away : home
  put(top, los - d, ['o', off])
  put(bot, los - d, ['o', off])
  put(top, los + d + (step > 4 ? -d : 0), ['x', def])
  put(bot, los + d, ['x', def])
  put(mid, los + 4 * d - Math.floor(run / 2) * d, ['x', def])
  put(mid, carrier, ['@', '#ffffff'])

  return rows.map(row =>
    row.map((seg, x): Seg => {
      if (seg) return seg
      if (x < 2 || x >= FIELD_W - 2) return ['░', '#40916c']
      if (x % 4 === 1) return ['¦', '#b7e4c7']

      return [' ']
    }),
  )
}

function advanceGame(game: Game): Game {
  let { home, away, scrimmage, offenseHome } = game
  const roll = Math.random()
  if (roll < 0.08) {
    // Turnover on downs, or a fumble: the other team takes over where it stands.
    return { home, away, scrimmage: FIELD_W - 1 - scrimmage, offenseHome: !offenseHome }
  }
  scrimmage += roll < 0.2 ? -1 : Math.floor(Math.random() * 6)
  if (scrimmage >= FIELD_W - 2) {
    if (offenseHome) home += 7
    else away += 7

    return { home, away, scrimmage: 5, offenseHome: !offenseHome }
  }

  return { home, away, scrimmage: Math.max(2, scrimmage), offenseHome }
}

// ─── The desktop / mobile backdrop ──────────────────────────────────────────
// Two strips pinned to the window's left and right edges (nested svgs with
// `meet`), so the art stays in the margins and clear of the conversation.
const SVG_DISHES = [
  // back row first, so the front row overlaps it: [x, y, kind]
  [62, 742, 'rolls'], [136, 742, 'corn'], [222, 742, 'cranberry'], [300, 742, 'wine'],
  [52, 786, 'potatoes'], [160, 786, 'turkey'], [262, 786, 'pie'], [326, 786, 'beans'],
] as const
const SVG_EAT_ORDER = [7, 1, 0, 4, 2, 3, 6, 5]

function dishSvg(x: number, y: number, kind: string, isEaten: boolean): string {
  const big = kind === 'turkey'
  const plate = kind === 'wine' ? '' : `<ellipse cx="${x}" cy="${y}" rx="${big ? 50 : 27}" ry="${big ? 12 : 8}" fill="#efe3cf"/><ellipse cx="${x}" cy="${y - 1}" rx="${big ? 40 : 20}" ry="${big ? 8 : 5}" fill="#e3d4bb"/>`
  if (isEaten) {
    if (kind === 'wine') return `<path d="M${x - 10} ${y - 58} h20 q0 26 -10 28 q-10 -2 -10 -28z" fill="#d8cfc0" opacity="0.35"/><path d="M${x} ${y - 30} v26 M${x - 9} ${y - 3} h18" stroke="#d8cfc0" stroke-width="2.5"/>`
    return `${plate}<circle cx="${x - 6}" cy="${y - 2}" r="2" fill="#a0784f"/><circle cx="${x + 5}" cy="${y}" r="1.6" fill="#a0784f"/><circle cx="${x + 1}" cy="${y - 4}" r="1.3" fill="#a0784f"/>${big ? `<path d="M${x - 18} ${y - 4} q18 -16 36 0" stroke="#efe3cf" stroke-width="4" fill="none"/>` : ''}`
  }
  switch (kind) {
    case 'turkey':
      return `${plate}<ellipse cx="${x}" cy="${y - 22}" rx="40" ry="25" fill="#a9622b"/><ellipse cx="${x - 8}" cy="${y - 32}" rx="22" ry="10" fill="#c98345" opacity="0.7"/><path d="M${x + 32} ${y - 18} l20 -14 a5 5 0 1 1 5 6 l-18 16z" fill="#b8733a"/><path d="M${x - 32} ${y - 18} l-20 -14 a5 5 0 1 0 -5 6 l18 16z" fill="#b8733a"/><circle cx="${x + 56}" cy="${y - 34}" r="4" fill="#f3ead8"/><circle cx="${x - 56}" cy="${y - 34}" r="4" fill="#f3ead8"/><path d="M${x - 30} ${y - 6} q8 -8 14 0 M${x + 18} ${y - 6} q8 -8 14 0" stroke="#6a994e" stroke-width="5" fill="none"/>`
    case 'pie':
      return `${plate}<path d="M${x - 24} ${y - 4} q24 -22 48 0z" fill="#c8813a"/><path d="M${x - 20} ${y - 6} q20 -16 40 0z" fill="#d9772b"/><ellipse cx="${x + 4}" cy="${y - 14}" rx="7" ry="4" fill="#fffaf0"/>`
    case 'corn':
      return `${plate}<ellipse cx="${x}" cy="${y - 8}" rx="20" ry="8" fill="#f2c94c"/><path d="M${x - 14} ${y - 9} h28" stroke="#e0b23a" stroke-width="1.5" stroke-dasharray="3 2"/><path d="M${x + 14} ${y - 8} l16 -8 l-4 12z" fill="#6a994e"/>`
    case 'potatoes':
      return `${plate}<ellipse cx="${x}" cy="${y - 10}" rx="20" ry="13" fill="#f4eee0"/><rect x="${x - 5}" y="${y - 25}" width="10" height="6" rx="1" fill="#f7d774"/>`
    case 'cranberry':
      return `${plate}<rect x="${x - 13}" y="${y - 30}" width="26" height="26" rx="4" fill="#9d0208"/><rect x="${x - 13}" y="${y - 30}" width="26" height="5" rx="2" fill="#c1121f"/><path d="M${x - 13} ${y - 20} h26 M${x - 13} ${y - 12} h26" stroke="#6a040f" stroke-width="1.5"/>`
    case 'rolls':
      return `${plate}<circle cx="${x - 9}" cy="${y - 9}" r="10" fill="#d4a373"/><circle cx="${x + 9}" cy="${y - 9}" r="10" fill="#c9915c"/><circle cx="${x}" cy="${y - 17}" r="10" fill="#ddb07f"/>`
    case 'beans':
      return `${plate}<ellipse cx="${x}" cy="${y - 7}" rx="21" ry="8" fill="#52734d"/><path d="M${x - 14} ${y - 9} h28 M${x - 10} ${y - 5} h22" stroke="#91c788" stroke-width="2"/>`
    case 'wine':
      return `<path d="M${x - 10} ${y - 58} h20 q0 26 -10 28 q-10 -2 -10 -28z" fill="#d8cfc0" opacity="0.35"/><path d="M${x - 9} ${y - 48} h18 q-1 16 -9 18 q-8 -2 -9 -18z" fill="#7b2d26"/><path d="M${x} ${y - 30} v26 M${x - 9} ${y - 3} h18" stroke="#d8cfc0" stroke-width="2.5"/>`
    default:
      return plate
  }
}

// A turkey in a pilgrim hat, perched at (x, y): the bottom of its feet.
function turkeySvg(x: number, y: number): string {
  const feathers = ['#9c2a1a', '#d9772b', '#f2c94c', '#d9772b', '#9c2a1a', '#7f4f24', '#c1440e']
  const fan = feathers
    .map((c, i) => `<ellipse cx="${x}" cy="${y - 62}" rx="11" ry="34" fill="${c}" transform="rotate(${-72 + i * 24} ${x} ${y - 34})"/>`)
    .join('')

  return `<g>${fan}
<ellipse cx="${x}" cy="${y - 30}" rx="24" ry="22" fill="#7f4f24"/>
<ellipse cx="${x}" cy="${y - 24}" rx="14" ry="13" fill="#a9622b"/>
<circle cx="${x + 2}" cy="${y - 58}" r="12" fill="#8a5a3b"/>
<circle cx="${x + 6}" cy="${y - 61}" r="2.6" fill="#1a0f08"/><circle cx="${x + 7}" cy="${y - 62}" r="0.9" fill="#fff"/>
<path d="M${x + 12} ${y - 58} l10 3 l-10 3z" fill="#f2b134"/>
<path d="M${x + 12} ${y - 54} q4 8 -1 12 q-4 -4 -2 -12z" fill="#c1121f"/>
<rect x="${x - 13}" y="${y - 90}" width="26" height="20" rx="2" fill="#1f1a17"/>
<rect x="${x - 21}" y="${y - 72}" width="42" height="5" rx="2" fill="#1f1a17"/>
<rect x="${x - 13}" y="${y - 78}" width="26" height="5" fill="#3a3330"/>
<rect x="${x - 5}" y="${y - 80}" width="10" height="9" fill="none" stroke="#e9c46a" stroke-width="2"/>
<path d="M${x - 8} ${y - 9} v9 M${x + 8} ${y - 9} v9 M${x - 13} ${y} h10 M${x + 3} ${y} h10" stroke="#f2b134" stroke-width="3" stroke-linecap="round"/>
</g>`
}

function sceneSvg(percent: number): string {
  const eaten = eatenSet(percent, SVG_DISHES.length, SVG_EAT_ORDER)
  const dishes = SVG_DISHES.map(([x, y, kind], i) => dishSvg(x, y, kind, eaten.has(i))).join('')
  const left = Math.max(0, 100 - percent)
  const yardLines = [0, 1, 2, 3, 4, 5]
    .map(i => `<line x1="${82 + i * 39}" y1="196" x2="${82 + i * 39}" y2="332" stroke="#d8f3dc" stroke-width="2" opacity="0.55"/>`)
    .join('')
  const leaves = [
    [110, 0, '#d9772b', 0], [200, -40, '#c1440e', -4], [250, -10, '#f2c94c', -8],
  ]
    .map(([x, dy, c, delay]) => `<path class="leaf" style="animation-delay: ${delay}s" d="M${x} ${250 + Number(dy)} q8 -10 16 0 q-8 10 -16 0z" fill="${c}"/>`)
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
<style>
.flame { transform-box: fill-box; transform-origin: 50% 100%; animation: flick 2.6s ease-in-out infinite; }
.f2 { animation-duration: 3.4s; animation-delay: -1.2s; }
.f3 { animation-duration: 2.9s; animation-delay: -0.6s; }
@keyframes flick { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(0.93, 1.12); } }
.glow { animation: glow 5s ease-in-out infinite; }
@keyframes glow { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.72; } }
.play { animation: drive 9s ease-in-out infinite; }
@keyframes drive { 0% { transform: translateX(0px); } 45% { transform: translateX(110px); } 55% { transform: translateX(110px); } 100% { transform: translateX(0px); } }
.sway { transform-box: view-box; transform-origin: 180px 0px; animation: sway 7s ease-in-out infinite; }
@keyframes sway { 0%, 100% { transform: rotate(-1.5deg); } 50% { transform: rotate(1.5deg); } }
.leaf { transform-box: fill-box; animation: fall 12s linear infinite; }
@keyframes fall { 0% { transform: translate(0px, 0px) rotate(0deg); } 100% { transform: translate(-40px, 260px) rotate(300deg); } }
.steam { animation: rise 7s ease-in-out infinite; }
@keyframes rise { 0% { transform: translateY(0px); opacity: 0.35; } 100% { transform: translateY(-40px); opacity: 0; } }
</style>
<defs>
<radialGradient id="fireglow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ff9f1c" stop-opacity="0.55"/><stop offset="1" stop-color="#ff9f1c" stop-opacity="0"/></radialGradient>
<linearGradient id="flameg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#e85d04"/><stop offset="0.6" stop-color="#ff9f1c"/><stop offset="1" stop-color="#ffd166"/></linearGradient>
<linearGradient id="night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d2340"/><stop offset="1" stop-color="#4a3a5c"/></linearGradient>
<clipPath id="pane"><rect x="72" y="252" width="216" height="226" rx="6"/></clipPath>
</defs>
<!-- the room, stretched to any window -->
<svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
<rect width="100" height="100" fill="#2e1d13"/>
<path d="M0 0 V88 M4 0 V88 M8 0 V88 M12 0 V88 M16 0 V88 M20 0 V88 M24 0 V88 M28 0 V88 M32 0 V88 M36 0 V88 M40 0 V88 M44 0 V88 M48 0 V88 M52 0 V88 M56 0 V88 M60 0 V88 M64 0 V88 M68 0 V88 M72 0 V88 M76 0 V88 M80 0 V88 M84 0 V88 M88 0 V88 M92 0 V88 M96 0 V88" stroke="#352217" stroke-width="1.6"/>
<rect y="70" width="100" height="18" fill="#3a2416"/>
<rect y="69" width="100" height="1.2" fill="#5a3a22"/>
<rect y="88" width="100" height="12" fill="#22140c"/>
<path d="M0 92 H100 M0 96 H100" stroke="#1a0f08" stroke-width="0.4"/>
</svg>
<!-- left margin: sign, window, fireplace -->
<svg width="100%" height="100%" viewBox="0 0 360 1000" preserveAspectRatio="xMinYMax meet">
<ellipse class="glow" cx="180" cy="800" rx="260" ry="260" fill="url(#fireglow)"/>
<g transform="translate(0 30)"><g class="sway">
<path d="M150 -30 L130 100 M210 -30 L230 100" stroke="#c2a27a" stroke-width="3"/>
<rect x="84" y="98" width="192" height="112" rx="12" fill="#6f4a2c" stroke="#4a2c1a" stroke-width="5"/>
<path d="M90 135 H270 M90 172 H270" stroke="#5a3a22" stroke-width="2"/>
<text x="180" y="166" text-anchor="middle" font-family="Georgia, serif" font-weight="bold" font-size="56" fill="#f6e8d6">${left}%</text>
<text x="180" y="196" text-anchor="middle" font-family="Georgia, serif" font-size="20" fill="#e9d5b7">feast left</text>
${turkeySvg(180, 100)}
</g></g>
<!-- window to the autumn night -->
<rect x="62" y="242" width="236" height="246" rx="10" fill="#4a2c1a"/>
<g clip-path="url(#pane)">
<rect x="72" y="252" width="216" height="226" fill="url(#night)"/>
<circle cx="236" cy="300" r="22" fill="#f1e3c6"/><circle cx="228" cy="294" r="4" fill="#ddcca9"/><circle cx="244" cy="310" r="3" fill="#ddcca9"/>
<path d="M72 430 Q140 400 200 432 T288 420 V478 H72 Z" fill="#2b2030"/>
<path d="M90 478 V380 M90 400 L60 360 M90 420 L130 370" stroke="#2b1a14" stroke-width="6" fill="none"/>
${leaves}
</g>
<path d="M180 252 V478 M72 365 H288" stroke="#4a2c1a" stroke-width="8"/>
<!-- fireplace -->
<rect x="30" y="580" width="300" height="300" fill="#6b2e1f"/>
<path d="M30 620 H330 M30 660 H330 M30 700 H330 M30 740 H330 M30 780 H330 M30 820 H330 M30 860 H330" stroke="#4e2015" stroke-width="3"/>
<rect x="14" y="548" width="332" height="34" rx="4" fill="#4a2c1a"/>
<path d="M80 880 V730 Q180 666 280 730 V880 Z" fill="#120806"/>
<rect x="104" y="846" width="152" height="20" rx="10" fill="#5a3a22"/>
<rect x="120" y="830" width="120" height="18" rx="9" fill="#6f4a2c" transform="rotate(-6 180 840)"/>
<path class="flame" d="M116 850 Q108 790 144 754 Q140 800 166 808 Q160 744 188 708 Q198 772 220 780 Q226 746 240 738 Q254 800 244 850 Z" fill="url(#flameg)"/>
<path class="flame f2" d="M140 850 Q134 810 158 786 Q164 814 180 818 Q178 782 194 762 Q208 808 220 850 Z" fill="#ffb703" opacity="0.9"/>
<path class="flame f3" d="M164 850 Q160 828 174 814 Q180 830 188 832 Q192 816 198 810 Q208 836 202 850 Z" fill="#fff3b0" opacity="0.85"/>
<ellipse cx="64" cy="528" rx="28" ry="21" fill="#e07a2e"/><path d="M64 508 v-10" stroke="#52734d" stroke-width="5"/>
<ellipse cx="108" cy="536" rx="16" ry="13" fill="#f4a259"/>
<ellipse cx="296" cy="526" rx="32" ry="23" fill="#d9772b"/><path d="M296 504 v-12" stroke="#52734d" stroke-width="5"/>
<rect x="160" y="500" width="14" height="48" rx="2" fill="#f3ead8"/><rect x="188" y="512" width="14" height="36" rx="2" fill="#efe3cf"/><path class="flame f3" d="M167 498 q-6 -10 0 -18 q6 8 0 18z" fill="#ffd166"/><path class="flame f2" d="M195 510 q-6 -10 0 -18 q6 8 0 18z" fill="#ffd166"/><path d="M228 546 q10 -30 34 -30 q-4 26 -34 30z" fill="#bc6c25"/><path d="M236 540 q8 -14 20 -18" stroke="#7f4f24" stroke-width="2" fill="none"/>
</svg>
<!-- right margin: the game on TV, the feast -->
<svg width="100%" height="100%" viewBox="0 0 360 1000" preserveAspectRatio="xMaxYMax meet">
<rect x="34" y="156" width="292" height="200" rx="12" fill="#0f0f12"/>
<rect x="50" y="170" width="260" height="170" fill="#2d6a4f"/>
<rect x="50" y="170" width="22" height="170" fill="#1b4332"/><rect x="288" y="170" width="22" height="170" fill="#1b4332"/>
${yardLines}
<rect x="50" y="170" width="260" height="22" fill="#0b0b0e" opacity="0.85"/>
<rect x="58" y="176" width="58" height="10" rx="2" fill="#ffb703"/><rect x="244" y="176" width="58" height="10" rx="2" fill="#caf0f8"/>
<rect x="164" y="176" width="32" height="10" rx="2" fill="#f6e8d6" opacity="0.7"/>
<g class="play">
<circle cx="96" cy="236" r="7" fill="#ffb703"/><circle cx="96" cy="300" r="7" fill="#ffb703"/><circle cx="84" cy="268" r="7" fill="#ffb703"/>
<ellipse cx="96" cy="268" rx="7" ry="4.5" fill="#7f4f24"/>
<circle cx="124" cy="244" r="7" fill="#caf0f8"/><circle cx="124" cy="292" r="7" fill="#caf0f8"/><circle cx="146" cy="268" r="7" fill="#caf0f8"/>
</g>
<rect x="164" y="356" width="32" height="34" fill="#1a1a1e"/>
<rect x="20" y="390" width="320" height="18" rx="4" fill="#3b2416"/>
<rect x="34" y="408" width="14" height="60" fill="#3b2416"/><rect x="312" y="408" width="14" height="60" fill="#3b2416"/>
<!-- the feast table -->
<path d="M6 720 H354 V806 H6 Z" fill="#8c3b2a"/>
<path d="M6 806 H354 L344 850 H16 Z" fill="#74301f"/>
<path d="M6 720 H354" stroke="#b5513a" stroke-width="4"/>
<rect x="30" y="850" width="18" height="40" fill="#5a3520"/><rect x="312" y="850" width="18" height="40" fill="#5a3520"/>
${dishes}
${eaten.has(5) ? '' : '<path class="steam" d="M160 700 q-10 -14 0 -26 q10 -12 0 -24" stroke="#f3ead8" stroke-width="3" fill="none" opacity="0.3"/>'}
</svg>
</svg>`
}

// ─── The look ───────────────────────────────────────────────────────────────
const { theme, problems } = makeColors({
  label: 'Thanksgiving den',
  only: 'dark',
  roles: { accent: '#e07a2e', danger: '#c0392b', success: '#6a994e', warning: '#e9a03b', pro: '#a06cd5' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#1c120c',
        'surface-1': '#24170f',
        'surface-2': '#2b1c13',
        'surface-3': '#302016',
        'text-primary': '#f6e8d6',
        'text-secondary': '#dcc7ad',
        'text-muted': '#b49c80',
      },
    },
  },
})

const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE, glass: { blur: 14, tint: '#1c120c', opacity: 0.5 } },
}
const SOUND: ThemeSetArgs['sound'] = {
  ambience: {
    layers: [
      { wave: 'brown', drone: true, gain: 0.12, filter: { type: 'lowpass', hz: 380 } },
      { wave: 'crackle', scatter: 2.5, gain: 0.22, release: 0.08 },
    ],
  },
}

// ─── Wiring ─────────────────────────────────────────────────────────────────
let lastStage = -1
const stageOf = (p: number) => (p >= 95 ? 4 : p >= 80 ? 3 : p >= 50 ? 2 : p >= 25 ? 1 : 0)
const STAGE_TOASTS = [
  '',
  '🍗 A quarter of the feast is gone already.',
  '🥧 Halfway through the feast. Pace yourself!',
  '😮‍💨 Loosening the belt... the table is getting bare.',
  '😴 Food coma imminent. /compact brings out the leftovers.',
]

async function setPercent($: EngineInterface, percent: number) {
  const before = await read($, percentAtom)
  await update($, percentAtom, () => percent)
  const left = Math.max(0, 100 - percent)
  $.ui.status(`🦃 ${left}% of the feast left`)
  const stage = stageOf(percent)
  if (lastStage >= 0 && percent + 15 < before) {
    $.ui.toast('🥡 Leftovers! The table has been restocked.')
  } else if (lastStage >= 0 && stage > lastStage && STAGE_TOASTS[stage]) {
    $.ui.toast(STAGE_TOASTS[stage])
  }
  lastStage = stage
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'thanksgiving',
      description: 'Open the Thanksgiving den: fireplace, football and the feast',
    })

    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))
    if (unpainted !== undefined) $.ui.log(unpainted)
    try {
      await $.theme.set({ ...LOOK, sound: SOUND })
    } catch {
      await $.theme.set(LOOK).catch(() => undefined)
    }

    const { context } = await $.session.usage()
    await setPercent($, context.percent ?? 0)

    $.clock.every(450, () => {
      void (async () => {
        const frame = await update($, frameAtom, f => f + 1)
        if (frame % 12 === 0) await update($, gameAtom, advanceGame)
      })()
    })

    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'thanksgiving' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: '🦃 Pull up a chair. The game is on and dinner is served.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context') && e.context.percent !== undefined) {
      await setPercent($, e.context.percent)
    }

    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.props.scene !== SCENE || (e.surface !== 'desktop' && e.surface !== 'mobile')) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    const percent = await read($, percentAtom)

    return (
      <Svg
        source={sceneSvg(percent)}
        alt="A cozy den: a turkey on a sign counting the feast left, a crackling fireplace, football on TV, and the Thanksgiving table"
      />
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const percent = await read($, percentAtom)
    const frame = await read($, frameAtom)
    const game = await read($, gameAtom)

    const line = (segs: Seg[]) => (
      <Text>
        {segs.map(([text, color]) => (color ? <Text color={color}>{text}</Text> : text))}
      </Text>
    )
    const brick = '#9c3d2a'
    const wood = '#8b5a2b'

    // Fireplace
    const fireplace = (
      <Box flexDirection="column" marginRight={3}>
        {line([['  🎃  🍂   🌾   🍁  🎃', '#e07a2e']])}
        {line([['▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄', wood]])}
        {line([[' █▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀█ ', brick]])}
        {[0, 1, 2].map(row => line([[' █ ', brick], ...flameRow(row, frame, 16), [' █ ', brick]]))}
        {line([
          [' █ ', brick],
          [frame % 4 < 2 ? ' ·▄██▄▄██▄▄██▄· ' : ' ˙▄██▄▄██▄▄██▄˙ ', frame % 4 < 2 ? '#a0522d' : '#b5651d'],
          [' █ ', brick],
        ])}
        {line([['▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀', wood]])}
      </Box>
    )

    // TV with the game
    const field = fieldRows(game, frame)
    const frameColor = '#6c757d'
    const score = ` GOBBLERS ${String(game.home).padStart(2)}    PILGRIMS ${String(game.away).padStart(2)} `
    const tv = (
      <Box flexDirection="column">
        {line([['╭' + '─'.repeat(FIELD_W + 2) + '╮', frameColor]])}
        {line([['│', frameColor], [score.padEnd(FIELD_W + 2).slice(0, FIELD_W + 2), '#ffffff'], ['│', frameColor]])}
        {field.map(row =>
          line([['│ ', frameColor], ...row.map(([t, c]): Seg => [t, c ?? '#2d6a4f']), [' │', frameColor]]),
        )}
        {line([['╰' + '─'.repeat(12) + '┬┬' + '─'.repeat(FIELD_W - 12) + '╯', frameColor]])}
        {line([[' '.repeat(10) + '══╧╧══', frameColor]])}
      </Box>
    )

    // The feast
    const eaten = eatenSet(percent, DISHES.length, EAT_ORDER)
    const dishRow = (from: number) => (
      <Text>
        {'  '}
        {DISHES.slice(from, from + 12).map((dish, i) =>
          eaten.has(from + i) ? <Text color="#7a5c3e">{'·· '}</Text> : `${dish} `,
        )}
      </Text>
    )
    const leftFrac = 1 - eaten.size / DISHES.length
    const barCells = 24
    const filled = Math.round(leftFrac * barCells)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          {fireplace}
          {tv}
        </Box>
        <Text> </Text>
        {line([['╔════════════ 🍂 THE FEAST 🍂 ════════════╗', '#d4a373']])}
        {dishRow(0)}
        {dishRow(12)}
        {line([['╚═╤════════════════════════════════════╤═╝', wood]])}
        {line([['  ╽                                    ╽', wood]])}
        {line([
          ['  '],
          ['█'.repeat(filled), '#e07a2e'],
          ['░'.repeat(barCells - filled), '#4a3526'],
          [`  ${Math.max(0, 100 - percent)}% of the feast left`, '#f6e8d6'],
        ])}
        <Text dimColor>{'  ' + mood(percent)}</Text>
      </Box>
    )
  })
}
