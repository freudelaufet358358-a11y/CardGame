/**
 * カードの DOM 生成と、カード詳細ポップオーバー。
 * デュエル画面とデッキビルダーの両方から使う。
 */

import { CIVS, KEYWORDS } from '../data/cards.js';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** キーワード能力を短い記号に */
const KW_MARK = {
  blocker: 'ブ',
  speed: '速',
  doubleBreaker: 'W',
  trigger: 'ST',
  slayer: 'ス',
};

/**
 * カード1枚の DOM を作る。
 * @param {object} card カード定義
 * @param {object} [opts] { mini, inst }
 */
export function cardEl(card, opts = {}) {
  const node = el('div', `card card--${card.civ}${opts.mini ? ' card--mini' : ''}`);
  node.dataset.cardId = card.id;

  const top = el('div', 'card__top');
  top.append(el('span', 'card__cost', String(card.cost)));
  top.append(el('span', 'card__civ', CIVS[card.civ].emoji));
  node.append(top);

  node.append(el('div', 'card__art', card.emoji));
  node.append(el('div', 'card__name', card.name));

  if (card.type === 'creature') {
    const stats = el('div', 'card__stats');
    const inst = opts.inst;
    const power = card.power + (inst?.powerBuff || 0);
    const guard = card.guard + (inst?.powerBuff || 0);
    const powEl = el('span', 'card__pow');
    powEl.append(el('i', null, '⚔️'), document.createTextNode(String(power)));
    const grdEl = el('span', 'card__grd');
    grdEl.append(el('i', null, '🛡'), document.createTextNode(String(guard)));
    if (inst?.powerBuff) powEl.style.color = inst.powerBuff > 0 ? '#8affb0' : '#ff8a8a';
    stats.append(powEl, grdEl);
    node.append(stats);
  } else {
    node.append(el('div', 'card__kind', card.type === 'spell' ? '呪文' : '罠'));
  }

  if (card.keywords?.length) {
    const kw = el('div', 'card__kw');
    for (const k of card.keywords) kw.append(el('span', null, KW_MARK[k] || k));
    node.append(kw);
  }

  attachPeek(node, card);
  return node;
}

/** 裏向きのカード */
export function backEl(kind, glyph) {
  return el('div', `cardback cardback--${kind}`, glyph);
}

/* ------------------------------------------------------------------ *
 * カード詳細のポップオーバー
 * ------------------------------------------------------------------ */

let peekNode = null;

function ensurePeek() {
  if (!peekNode) peekNode = document.getElementById('cardpeek');
  return peekNode;
}

export function cardDetailHTML(card) {
  const civ = CIVS[card.civ];
  const typeName = { creature: 'クリーチャー', spell: '呪文', trap: '罠' }[card.type];
  const stats = card.type === 'creature'
    ? ` ／ パワー ${card.power} ／ ガード ${card.guard}`
    : '';
  const kw = (card.keywords || [])
    .map((k) => `<b>${KEYWORDS[k].name}</b>：${KEYWORDS[k].text}`)
    .join('<br>');
  return `
    <h4>${card.emoji} ${card.name}</h4>
    <div class="cardpeek__meta">${civ.emoji}${civ.name}文明 ／ コスト ${card.cost} ／ ${typeName}${stats}</div>
    <div class="cardpeek__text">${card.text || ''}${kw ? `<hr style="border:0;border-top:1px solid #33406b;margin:8px 0">${kw}` : ''}</div>
  `;
}

/** カード要素にホバー/長押しで詳細を出す挙動を付ける */
export function attachPeek(node, card) {
  const show = (event) => {
    const peek = ensurePeek();
    if (!peek) return;
    peek.innerHTML = cardDetailHTML(card);
    peek.style.setProperty('--civ', CIVS[card.civ].color);
    peek.hidden = false;

    const rect = node.getBoundingClientRect();
    const width = 232;
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
