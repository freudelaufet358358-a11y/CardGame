/**
 * デッキビルダー。
 *
 * 左にカードプール、右に構築中のデッキ。左クリックで1枚追加、
 * 右クリック（またはデッキ一覧のクリック）で1枚減らす。
 * 保存は localStorage（storage.js）。
 */

import { ALL_CARDS, CIVS, getCard } from '../data/cards.js';
import {
  DECK_SIZE, MAX_COPIES, PRESET_DECKS, manaCurve, recipeCount, validateRecipe,
} from '../data/decks.js';
import { deleteDeck, loadDecks, saveDeck } from './storage.js';
import { cardEl, el } from './cardview.js';

const TYPE_FILTERS = [
  { key: 'all', label: 'すべて' },
  { key: 'creature', label: 'クリーチャー' },
  { key: 'spell', label: '呪文' },
  { key: 'trap', label: '罠' },
];

let recipe = {};
let filterCiv = 'all';
let filterType = 'all';
let bound = false;
let onDecksChanged = null;

export function openDeckBuilder(options = {}) {
  onDecksChanged = options.onDecksChanged || null;
  if (!bound) {
    bindEvents();
    bound = true;
  }
  if (Object.keys(recipe).length === 0) {
    recipe = { ...PRESET_DECKS[0].recipe };
    document.getElementById('db-name').value = '';
  }
  renderFilters();
  renderSavedList();
  renderAll();
}

function bindEvents() {
  document.getElementById('db-save').addEventListener('click', onSave);
  document.getElementById('db-clear').addEventListener('click', () => {
    recipe = {};
    message('デッキを空にしました。', '');
    renderAll();
  });
  document.getElementById('db-load').addEventListener('change', onLoad);
  document.getElementById('db-delete').addEventListener('click', onDelete);
}

/* ------------------------------------------------------------------ *
 * フィルタ
 * ------------------------------------------------------------------ */

function renderFilters() {
  const civBar = document.getElementById('db-filter-civ');
  civBar.replaceChildren();
  const civOptions = [['all', 'すべての文明'], ...Object.entries(CIVS).map(([k, v]) => [k, v.name])];
  for (const [key, label] of civOptions) {
    const btn = el('button', filterCiv === key ? 'is-on' : null, label);
    btn.type = 'button';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(filterCiv === key));
    btn.addEventListener('click', () => { filterCiv = key; renderFilters(); renderPool(); });
    civBar.append(btn);
  }

  const typeBar = document.getElementById('db-filter-type');
  typeBar.replaceChildren();
  for (const { key, label } of TYPE_FILTERS) {
    const btn = el('button', filterType === key ? 'is-on' : null, label);
    btn.type = 'button';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(filterType === key));
    btn.addEventListener('click', () => { filterType = key; renderFilters(); renderPool(); });
    typeBar.append(btn);
  }
}

/* ------------------------------------------------------------------ *
 * 描画
 * ------------------------------------------------------------------ */

function renderAll() {
  renderPool();
  renderDeckList();
  renderStats();
}

function renderPool() {
  const pool = document.getElementById('db-pool');
  pool.replaceChildren();

  const cards = ALL_CARDS
    .filter((c) => filterCiv === 'all' || c.civ === filterCiv)
    .filter((c) => filterType === 'all' || c.type === filterType)
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'ja'));

  for (const card of cards) {
    const count = recipe[card.id] || 0;
    const wrap = el('div', `poolitem${count >= MAX_COPIES ? ' is-full' : ''}`);
    const node = cardEl(card);
    node.addEventListener('click', () => add(card.id));
    node.addEventListener('contextmenu', (event) => { event.preventDefault(); remove(card.id); });
    wrap.append(node);
    if (count > 0) wrap.append(el('div', 'poolitem__count', `×${count}`));
    pool.append(wrap);
  }
}

function renderDeckList() {
  const list = document.getElementById('db-list');
  list.replaceChildren();

  const entries = Object.entries(recipe)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ card: getCard(id), n }))
    .sort((a, b) => a.card.cost - b.card.cost || a.card.name.localeCompare(b.card.name, 'ja'));

  if (entries.length === 0) {
    list.append(el('li', 'is-empty', 'カードを追加してください'));
    return;
  }

  for (const { card, n } of entries) {
    const li = el('li');
    li.title = 'クリックで1枚減らす';
    const cost = el('span', 'decklist__cost', String(card.cost));
    cost.style.setProperty('--civ', `var(--civ-${card.civ})`);
    li.append(cost);
    li.append(el('span', 'decklist__name', `${card.emoji} ${card.name}`));
    li.append(el('span', 'decklist__n', `×${n}`));
    li.addEventListener('click', () => remove(card.id));
    list.append(li);
  }
}

function renderStats() {
  const stats = document.getElementById('db-stats');
  stats.replaceChildren();
  const total = recipeCount(recipe);
  document.getElementById('db-count').textContent = `${total} / ${DECK_SIZE}`;

  // 文明の内訳
  const civCounts = {};
  for (const [id, n] of Object.entries(recipe)) {
    if (!n) continue;
    const { civ } = getCard(id);
    civCounts[civ] = (civCounts[civ] || 0) + n;
  }
  const civRow = el('div', 'deckstats__row');
  civRow.append(el('span', null, '文明'));
  const bar = el('div', 'civbar');
  for (const [civ, n] of Object.entries(civCounts)) {
    const seg = el('i');
    seg.style.width = `${(n / Math.max(total, 1)) * 100}%`;
    seg.style.background = `var(--civ-${civ})`;
    seg.title = `${CIVS[civ].name}: ${n}枚`;
    bar.append(seg);
  }
  civRow.append(bar);
  const civText = Object.entries(civCounts)
    .map(([civ, n]) => `${CIVS[civ].name}${n}`).join(' ') || '―';
  civRow.append(el('span', null, civText));
  stats.append(civRow);

  // マナカーブ
  const curve = manaCurve(recipe);
  const max = Math.max(1, ...Object.values(curve));
  const curveEl = el('div', 'curve');
  for (const [cost, n] of Object.entries(curve)) {
    const barEl = el('div', 'curve__bar');
    barEl.style.height = `${(n / max) * 100}%`;
    barEl.title = `コスト${cost}: ${n}枚`;
    if (n > 0) barEl.append(el('i', null, String(n)));
    barEl.append(el('span', null, cost === '7' ? '7+' : cost));
    curveEl.append(barEl);
  }
  stats.append(el('div', null, 'マナカーブ'));
  stats.append(curveEl);

  const result = validateRecipe(recipe);
  if (!result.ok) message(result.errors[0], 'is-error');
  else message('このデッキで対戦できます。', 'is-ok');
}

function message(text, cls) {
  const node = document.getElementById('db-message');
  node.className = `hint ${cls || ''}`.trim();
  node.textContent = text;
}

/* ------------------------------------------------------------------ *
 * 編集
 * ------------------------------------------------------------------ */

function add(cardId) {
  const count = recipe[cardId] || 0;
  if (count >= MAX_COPIES) {
    message(`「${getCard(cardId).name}」は${MAX_COPIES}枚までです。`, 'is-error');
    return;
  }
  if (recipeCount(recipe) >= DECK_SIZE) {
    message(`デッキは${DECK_SIZE}枚までです。減らしてから追加してください。`, 'is-error');
    return;
  }
  recipe[cardId] = count + 1;
  renderAll();
}

function remove(cardId) {
  const count = recipe[cardId] || 0;
  if (count <= 0) return;
  if (count === 1) delete recipe[cardId];
  else recipe[cardId] = count - 1;
  renderAll();
}

/* ------------------------------------------------------------------ *
 * 保存・読み込み
 * ------------------------------------------------------------------ */

function renderSavedList() {
  const select = document.getElementById('db-load');
  select.replaceChildren();
  select.append(new Option('― 選択してください ―', ''));

  const presetGroup = document.createElement('optgroup');
  presetGroup.label = 'プリセット';
  for (const deck of PRESET_DECKS) presetGroup.append(new Option(deck.name, `preset:${deck.id}`));
  select.append(presetGroup);

  const saved = loadDecks();
  if (saved.length > 0) {
    const group = document.createElement('optgroup');
    group.label = '保存したデッキ';
    for (const deck of saved) group.append(new Option(deck.name, `custom:${deck.id}`));
    select.append(group);
  }
}

function onLoad(event) {
  const value = event.target.value;
  if (!value) return;
  const [kind, id] = value.split(':');
  if (kind === 'preset') {
    const deck = PRESET_DECKS.find((d) => d.id === id);
    if (!deck) return;
    recipe = { ...deck.recipe };
    document.getElementById('db-name').value = `${deck.name} のコピー`;
  } else {
    const deck = loadDecks().find((d) => d.id === id);
    if (!deck) return;
    recipe = { ...deck.recipe };
    document.getElementById('db-name').value = deck.name;
  }
  renderAll();
  message('読み込みました。', '');
}

function onSave() {
  const nameInput = document.getElementById('db-name');
  const name = nameInput.value.trim() || 'マイデッキ';
  const result = validateRecipe(recipe);
  if (!result.ok) {
    message(`保存できません: ${result.errors[0]}`, 'is-error');
    return;
  }
  const saved = saveDeck(name, { ...recipe });
  if (!saved) {
    message('保存できませんでした（ブラウザの保存領域が使えない設定かもしれません）。', 'is-error');
    return;
  }
  nameInput.value = name;
  renderSavedList();
  message(`「${name}」を保存しました。対戦準備の画面から選べます。`, 'is-ok');
  onDecksChanged?.();
}

function onDelete() {
  const select = document.getElementById('db-load');
  const value = select.value;
  if (!value.startsWith('custom:')) {
    message('削除できるのは保存したデッキだけです。上の一覧から選んでください。', 'is-error');
    return;
  }
  const id = value.slice('custom:'.length);
  const deck = loadDecks().find((d) => d.id === id);
  if (!deck) return;
  if (!window.confirm(`「${deck.name}」を削除しますか？`)) return;
  deleteDeck(id);
  renderSavedList();
  message(`「${deck.name}」を削除しました。`, '');
  onDecksChanged?.();
}
