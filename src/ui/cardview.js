/**
 * カードの DOM 生成と、カード詳細ポップオーバー。
 * デュエル画面とデッキビルダーの両方から使う。
 *
 * カードは <button> として生成する。キーボードで Tab 移動と Enter 選択ができ、
 * aria-label に名前・文明・コスト・数値を持たせるので読み上げでも盤面が分かる。
 */

import { CIVS, KEYWORDS } from '../data/cards.js';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 文明を表す一文字。絵文字は環境で字形が変わるので、カード上ではこちらを使う */
export const CIV_KANJI = {
  light: '光',
  water: '水',
  dark: '闇',
  fire: '火',
  nature: '自',
};

/** キーワード能力の短い表記（カード右肩のタグ） */
const KW_MARK = {
  blocker: 'ブロッカー',
  speed: 'SA',
  doubleBreaker: 'W',
  trigger: 'ST',
  slayer: 'スレイヤー',
};

const TYPE_NAME = { creature: 'クリーチャー', spell: '呪文', trap: '罠' };

/** 読み上げ用の一文 */
export function cardLabel(card, inst) {
  const parts = [card.name, `${CIVS[card.civ].name}文明`, `コスト${card.cost}`, TYPE_NAME[card.type]];
  if (card.type === 'creature') {
    const buff = inst?.powerBuff || 0;
    parts.push(`パワー${card.power + buff}`, `ガード${card.guard + buff}`);
  }
  if (card.keywords?.length) parts.push(card.keywords.map((k) => KEYWORDS[k].name).join('、'));
  return parts.join('、');
}

/**
 * カード1枚の DOM を作る。
 * @param {object} card カード定義
 * @param {object} [opts] { mini, inst }
 */
export function cardEl(card, opts = {}) {
  const node = el('button', `card card--${card.civ}${opts.mini ? ' card--mini' : ''}`);
  node.type = 'button';
  node.dataset.cardId = card.id;
  node.setAttribute('aria-label', cardLabel(card, opts.inst));

  node.append(el('span', 'card__cost', String(card.cost)));
  node.append(el('span', 'card__civ', CIV_KANJI[card.civ]));
  node.append(el('span', 'card__art', card.emoji));
  node.append(el('span', 'card__name', card.name));

  if (card.type === 'creature') {
    const stats = el('span', 'card__stats');
    const inst = opts.inst;
    const buff = inst?.powerBuff || 0;
    const buffClass = buff > 0 ? ' is-up' : buff < 0 ? ' is-down' : '';
    const powEl = el('span', `card__pow${buffClass}`);
    powEl.append(el('small', null, '攻'), document.createTextNode(String(card.power + buff)));
    const grdEl = el('span', `card__grd${buffClass}`);
    grdEl.append(el('small', null, '守'), document.createTextNode(String(card.guard + buff)));
    stats.append(powEl, grdEl);
    node.append(stats);
  } else {
    node.append(el('span', 'card__kind', TYPE_NAME[card.type]));
  }

  if (card.keywords?.length) {
    const kw = el('span', 'card__kw');
    for (const k of card.keywords) kw.append(el('span', null, KW_MARK[k] || k));
    node.append(kw);
  }

  attachPeek(node, card);
  return node;
}

/** 裏向きのカード。中身は見せないので読み上げからも外す */
export function backEl(kind) {
  const node = el('span', `cardback cardback--${kind}`);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

/* ------------------------------------------------------------------ *
 * カード詳細のポップオーバー
 * ------------------------------------------------------------------ */

let peekNode = null;

function ensurePeek() {
  if (!peekNode) peekNode = document.getElementById('cardpeek');
  return peekNode;
}

function escapeHTML(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function cardDetailHTML(card) {
  const civ = CIVS[card.civ];
  const stats = card.type === 'creature'
    ? ` ／ 攻 <b>${card.power}</b> ／ 守 <b>${card.guard}</b>`
    : '';
  const kw = (card.keywords || [])
    .map((k) => `<b>${KEYWORDS[k].name}</b>：${escapeHTML(KEYWORDS[k].text)}`)
    .join('<br>');
  return `
    <h4>${card.emoji} ${escapeHTML(card.name)}</h4>
    <div class="cardpeek__meta">${CIV_KANJI[card.civ]}・${civ.name}文明 ／ コスト <b>${card.cost}</b> ／ ${TYPE_NAME[card.type]}${stats}</div>
    <div class="cardpeek__text">${escapeHTML(card.text || '')}${kw ? `<div class="cardpeek__kw">${kw}</div>` : ''}</div>
  `;
}

/** カード要素にホバー／フォーカス／長押しで詳細を出す挙動を付ける */
export function attachPeek(node, card) {
  const show = (event) => {
    const peek = ensurePeek();
    if (!peek) return;
    peek.innerHTML = cardDetailHTML(card);
    peek.style.setProperty('--civ', `var(--civ-${card.civ})`);
    peek.hidden = false;

    const rect = node.getBoundingClientRect();
    const width = peek.offsetWidth || 248;
    let left = rect.right + 10;
    if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - width - 10);
    let top = rect.top;
    const height = peek.offsetHeight;
    if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8);
    peek.style.left = `${left}px`;
    peek.style.top = `${top}px`;
    if (event?.type === 'touchstart') event.stopPropagation();
  };
  const hide = () => { const peek = ensurePeek(); if (peek) peek.hidden = true; };

  node.addEventListener('mouseenter', show);
  node.addEventListener('mouseleave', hide);
  node.addEventListener('focus', show);
  node.addEventListener('blur', hide);
  // タッチ端末では長押しで表示
  let timer = null;
  node.addEventListener('touchstart', () => { timer = setTimeout(show, 380); }, { passive: true });
  node.addEventListener('touchend', () => { clearTimeout(timer); setTimeout(hide, 2200); });
  node.addEventListener('touchmove', () => clearTimeout(timer), { passive: true });
}

export function hidePeek() {
  const peek = ensurePeek();
  if (peek) peek.hidden = true;
}
