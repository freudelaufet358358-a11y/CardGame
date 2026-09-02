/**
 * カードの絵柄（インライン SVG）。
 *
 * 外部画像を持たない方針のまま、絵文字をやめて自前の線画にする。
 * OS・ブラウザで字形が変わらず、文明ごとの背景紋（BACKDROP）と
 * カードごとの図案（GLYPH）の組み合わせで 40 種を見分けられるようにしている。
 *
 *   - 座標系は 48×48。線は currentColor、太さ 2.6、丸い端点
 *   - 背景紋は文明色を薄く敷く。図案はカードのインク色で描く
 *   - 図案はカード名の題材（盾・鯨・王冠…）を 1 モチーフに絞る
 */

const S = 'fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="currentColor" stroke="none"';

/** 文明ごとの背景紋。図案の後ろに薄く敷く */
export const BACKDROP = {
  light: `<g ${S} stroke-width="2"><circle cx="24" cy="24" r="12"/>
    <path d="M24 4v5M24 39v5M4 24h5M39 24h5M9.9 9.9l3.5 3.5M34.6 34.6l3.5 3.5M9.9 38.1l3.5-3.5M34.6 13.4l3.5-3.5"/></g>`,
  water: `<g ${S} stroke-width="2"><path d="M4 18c5-5 10-5 15 0s10 5 15 0 7-4 10-1"/>
    <path d="M4 28c5-5 10-5 15 0s10 5 15 0 7-4 10-1"/><path d="M4 38c5-5 10-5 15 0s10 5 15 0 7-4 10-1"/></g>`,
  dark: `<g ${F}><path d="M30 5a19 19 0 1 0 13 30 15 15 0 0 1-13-30z"/></g>`,
  fire: `<g ${F}><path d="M24 3c2 8 10 12 10 22a10 10 0 0 1-20 0c0-4 2-7 4-9 0 4 2 6 4 6-1-6 0-13 2-19z"/></g>`,
  nature: `<g ${S} stroke-width="2"><path d="M8 40C8 20 20 8 40 8c0 20-12 32-32 32z"/><path d="M8 40L34 14"/>
    <path d="M14 30c6 0 10-2 14-6M22 38c4-2 8-6 10-12"/></g>`,
};

/** カードごとの図案 */
const GLYPH = {
  // ---- 光 ----
  li01: `<path ${S} d="M24 6l14 5v11c0 9-6 16-14 20-8-4-14-11-14-20V11z"/><path ${S} d="M24 14v20M16 24h16"/>`,
  li02: `<path ${S} d="M12 32c6-8 14-12 24-10l6-2-4 5c-4 8-14 12-24 10z"/><path ${S} d="M20 28c-2-8 2-16 10-20-1 6 0 12 4 16"/><path ${S} d="M12 32l-6 6"/><circle cx="36" cy="22" r="1.6" ${F}/>`,
  li03: `<path ${S} d="M24 8v32M14 40h20M10 16h28"/><path ${S} d="M10 16l-5 12h10zM38 16l-5 12h10z"/>`,
  li04: `<ellipse cx="24" cy="6" rx="6" ry="2.2" ${S}/><circle cx="24" cy="14" r="4" ${S}/><path ${S} d="M19 21h10l5 19H14z"/><path ${S} d="M18 24c-6-3-12-1-15 5 5 3 10 2 15 0M30 24c6-3 12-1 15 5-5 3-10 2-15 0"/>`,
  li05: `<path ${S} d="M6 34a18 18 0 0 1 36 0"/><path ${S} d="M6 34h36"/><path ${S} d="M24 8l1.5 4 4 1.5-4 1.5L24 19l-1.5-4-4-1.5 4-1.5zM10 18l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z"/>`,
  li06: `<circle cx="24" cy="24" r="7" ${F}/><path ${S} d="M24 6v6M24 36v6M6 24h6M36 24h6M11.3 11.3l4.2 4.2M32.5 32.5l4.2 4.2M11.3 36.7l4.2-4.2M32.5 15.5l4.2-4.2"/>`,
  li07: `<path ${S} d="M24 6v4M14 30c0-10 2-18 10-18s10 8 10 18l4 4H10z"/><path ${S} d="M20 38a4 4 0 0 0 8 0"/>`,
  li08: `<ellipse cx="24" cy="22" rx="12" ry="15" ${S}/><path ${S} d="M18 14c2-3 5-5 8-5M20 40h8M24 37v3"/>`,

  // ---- 水 ----
  wa01: `<path ${S} d="M8 24c6-8 14-12 22-10 4 1 8 5 12 10-4 5-8 9-12 10-8 2-16-2-22-10z"/><path ${S} d="M8 24l-4-8M8 24l-4 8"/><circle cx="32" cy="21" r="2" ${F}/>`,
  wa02: `<path ${S} d="M24 8v34M12 14c0 8 4 12 12 12s12-4 12-12"/><path ${S} d="M12 14v-4M36 14v-4M24 8l-3 4h6z"/>`,
  wa03: `<path ${S} d="M24 24c0-4 4-6 8-4s5 8 1 12-12 4-16 0-6-14 0-20 18-6 22 2"/>`,
  wa04: `<path ${S} d="M6 26c4-10 14-14 26-12 6 1 10 5 10 10 0 4-4 8-12 8H6z"/><path ${S} d="M6 26l6 8M38 20l6-6M38 20l6 6"/><circle cx="34" cy="22" r="2" ${F}/>`,
  wa05: `<rect x="10" y="12" width="20" height="26" rx="2" ${S}/><rect x="18" y="8" width="20" height="26" rx="2" ${S}/><path ${S} d="M24 20h8M24 26h8"/>`,
  wa06: `<path ${S} d="M6 30c5-6 10-6 15 0s10 6 15 0 6-4 8-2"/><path ${S} d="M34 12H14l5-5M14 12l5 5"/>`,
  wa07: `<path ${S} d="M24 6c6 8 10 13 10 19a10 10 0 0 1-20 0c0-6 4-11 10-19z"/><path ${S} d="M8 40c4-3 8-3 12 0s8 3 12 0 8-3 8 0"/>`,
  wa08: `<circle cx="18" cy="28" r="9" ${S}/><circle cx="32" cy="16" r="6" ${S}/><circle cx="34" cy="32" r="4" ${S}/><path ${S} d="M14 24a5 5 0 0 1 4-4"/>`,

  // ---- 闇 ----
  da01: `<path ${S} d="M12 40V18a12 12 0 0 1 24 0v22"/><path ${S} d="M8 40h32M24 22v10M20 26h8"/>`,
  da02: `<path ${S} d="M10 38L30 18M30 18l8-8-2 8-6 0z"/><path ${S} d="M14 26l8 8M8 36l4 4"/>`,
  da03: `<path ${S} d="M12 22a12 12 0 0 1 24 0v6l-4 4v6h-16v-6l-4-4z"/><circle cx="19" cy="22" r="3" ${F}/><circle cx="29" cy="22" r="3" ${F}/><path ${S} d="M22 36v4M26 36v4"/>`,
  da04: `<path ${S} d="M8 36V16l9 8 7-12 7 12 9-8v20z"/><path ${S} d="M8 36h32"/><circle cx="24" cy="30" r="2" ${F}/>`,
  da05: `<path ${S} d="M30 6a18 18 0 1 0 12 30 14 14 0 0 1-12-30z"/><path ${S} d="M12 12l24 24"/>`,
  da06: `<ellipse cx="24" cy="28" rx="7" ry="9" ${S}/><circle cx="24" cy="15" r="4" ${S}/><path ${S} d="M17 22L6 14M17 28H4M17 33l-9 8M31 22l11-8M31 28h13M31 33l9 8"/>`,
  da07: `<circle cx="24" cy="20" r="12" ${S}/><path ${S} d="M14 40h20M18 36l-2 4M30 36l2 4M18 36h12"/><path ${S} d="M18 16a6 6 0 0 1 6-4"/>`,
  da08: `<rect x="6" y="18" width="12" height="12" rx="6" ${S}/><rect x="18" y="18" width="12" height="12" rx="6" ${S}/><rect x="30" y="18" width="12" height="12" rx="6" ${S}/>`,

  // ---- 火 ----
  fi01: `<circle cx="22" cy="28" r="12" ${S}/><path ${S} d="M28 18l4-6M32 12l4-3M32 12c2-1 4 1 5 3"/><circle cx="18" cy="26" r="2" ${F}/>`,
  fi02: `<path ${S} d="M26 8l14 14-4 4L22 12z"/><path ${S} d="M22 12L10 24M14 30l-4 4M10 24l6 6M6 40l6-6"/>`,
  fi03: `<path ${S} d="M10 28c0-8 6-14 14-14s14 6 14 14c0 7-5 10-14 10S10 35 10 28z"/><path ${S} d="M12 20l-5-8 9 3M36 20l5-8-9 3"/><ellipse cx="24" cy="32" rx="5" ry="3.5" ${S}/><circle cx="18" cy="25" r="1.8" ${F}/><circle cx="30" cy="25" r="1.8" ${F}/><path ${S} d="M15 36l-3 6M33 36l3 6"/>`,
  fi04: `<path ${S} d="M6 30c6-8 14-12 24-10l10-6-4 10c2 4 0 10-6 12H16z"/><path ${S} d="M16 36l-4 6M28 36l4 6"/><circle cx="32" cy="24" r="2" ${F}/>`,
  fi05: `<path ${S} d="M24 4l3 10 9-5-5 9 10 3-10 3 5 9-9-5-3 10-3-10-9 5 5-9L7 21l10-3-5-9 9 5z"/>`,
  fi06: `<path ${S} d="M8 8l24 24M40 8L16 32"/><path ${S} d="M8 8h6v6M40 8h-6v6M10 34l6 6M38 34l-6 6M14 30l4 4M34 30l-4 4"/>`,
  fi07: `<path ${S} d="M6 22h14l18-10v24L20 26H6z"/><path ${S} d="M20 26v10M12 36h12"/>`,
  fi08: `<path ${S} d="M24 4c2 6 8 9 8 16a8 8 0 0 1-16 0c0-3 1-5 3-7 0 3 2 4 3 4-1-4 0-9 2-13z"/><path ${S} d="M20 28h8l2 14H18z"/>`,

  // ---- 自然 ----
  na01: `<path ${S} d="M24 42V24"/><path ${S} d="M24 26c-8 0-14-6-14-14 8 0 14 6 14 14zM24 20c0-8 6-14 14-14 0 8-6 14-14 14z"/>`,
  na02: `<path ${S} d="M16 42V10"/><path ${S} d="M16 12c-6 0-10-4-10-8 6 0 10 4 10 8z"/><path ${S} d="M22 42l6-16 6 16M24 34h8"/>`,
  na03: `<path ${S} d="M8 38l4-14h24l4 14z"/><path ${S} d="M14 24l4-12h12l4 12"/><path ${S} d="M20 12c0-3 4-6 8-3"/>`,
  na04: `<path ${S} d="M24 42V26"/><path ${S} d="M12 26c-6-6-4-16 4-18 2-6 14-6 16 0 8 2 10 12 4 18z"/><path ${S} d="M18 42h12"/>`,
  na05: `<path ${S} d="M10 26c0-8 6-14 14-14s14 6 14 14v10H10z"/><path ${S} d="M14 36c-6 0-8 4-6 8M34 36c6 0 8 4 6 8"/><circle cx="19" cy="26" r="2" ${F}/><circle cx="29" cy="26" r="2" ${F}/>`,
  na06: `<circle cx="24" cy="24" r="18" ${S}/><ellipse cx="24" cy="24" rx="8" ry="18" ${S}/><path ${S} d="M6 24h36M9 14h30M9 34h30"/>`,
  na07: `<path ${S} d="M8 40C8 22 20 10 40 8c0 20-12 32-32 32z"/><path ${S} d="M8 40L32 16"/>`,
  na08: `<path ${S} d="M6 34c6-8 12-10 18-8s12 0 18-8"/><path ${S} d="M12 28l-2-6M20 27l2-6M30 26l-2-6M36 22l2-6M16 30l-4 4M26 26l4 4"/>`,
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * カードの絵柄を SVG 要素として作る。
 * @param {object} card カード定義（id, civ を使う）
 * @param {object} [opts] { backdrop: 背景紋を敷くか（既定 true） }
 */
export function cardArt(card, opts = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('class', 'art');
  svg.setAttribute('aria-hidden', 'true');
  const backdrop = opts.backdrop === false ? '' : `<g class="art__back">${BACKDROP[card.civ] || ''}</g>`;
  svg.innerHTML = `${backdrop}<g class="art__glyph">${GLYPH[card.id] || fallbackGlyph(card)}</g>`;
  return svg;
}

/** 図案が未定義のカード用（コストの数字を刻む） */
function fallbackGlyph(card) {
  return `<circle cx="24" cy="24" r="14" ${S}/><text x="24" y="30" text-anchor="middle" font-size="16" font-weight="700" ${F}>${card.cost}</text>`;
}

/** 図案が全カードぶんあるかの検査（自動テスト用） */
export function missingArt(cardIds) {
  return cardIds.filter((id) => !GLYPH[id]);
}
