/**
 * 画面のルーティング（URL ハッシュ）、対戦準備、見た目（スキン）の切り替え。
 *
 * 画面は location.hash で表す（#setup-cpu, #duel, #deckbuilder, #rules）。
 * ブラウザの戻る／進むはハッシュの変化として届くので、それを画面切り替えに使う。
 * 対戦中の状態は duel.js が localStorage に保存しており、
 * リロードや戻るで離れても #duel に来れば続きから再開できる。
 */

import { CIVS } from './data/cards.js';
import { PRESET_DECKS, expandDeck, recipeCivs, validateRecipe } from './data/decks.js';
import { DIFFICULTIES } from './ai/cpu.js';
import { isDuelActive, startDuel, stopDuel } from './ui/duel.js';
import { openDeckBuilder } from './ui/deckbuilder.js';
import { renderRules } from './ui/rulesdoc.js';
import { loadDecks, loadGame, loadPrefs, savePrefs } from './ui/storage.js';
import { el, hidePeek } from './ui/cardview.js';

const SCREENS = {
  title: 'screen-title',
  setup: 'screen-setup',
  duel: 'screen-duel',
  deckbuilder: 'screen-deckbuilder',
  rules: 'screen-rules',
};

/** 見た目。色・書体・形のトークンを CSS 側で差し替える */
const SKINS = [
  { key: 'felt', label: '卓上', themeColor: '#34393a' },
  { key: 'console', label: '計器盤', themeColor: '#1c1e1a' },
  { key: 'manual', label: '説明書', themeColor: '#f7f6f1' },
];

const setup = {
  mode: 'cpu',
  deck: [null, null],
  difficulty: 'normal',
  first: 'random', // 'me' | 'foe' | 'random'
};

/* ------------------------------------------------------------------ *
 * ルーティング
 * ------------------------------------------------------------------ */

function currentRoute() {
  return decodeURIComponent(location.hash.replace(/^#/, '')) || 'title';
}

/** 画面を切り替えたいときはこれを呼ぶ。ハッシュを変え、hashchange 経由で route() が走る */
function navigate(name) {
  if (currentRoute() === name) {
    route(name);
    return;
  }
  location.hash = name === 'title' ? '' : name;
}

/** 指定の画面だけを表示する */
function showScreen(name) {
  hidePeek();
  if (name !== 'duel') stopDuel();
  for (const [key, id] of Object.entries(SCREENS)) {
    document.getElementById(id).classList.toggle('is-active', key === name);
  }
  window.scrollTo(0, 0);
}

/** ハッシュに対応する画面を出す */
function route(name) {
  if (name === 'setup-cpu') return openSetup('cpu');
  if (name === 'setup-hotseat') return openSetup('hotseat');

  if (name === 'duel') {
    if (isDuelActive()) return showScreen('duel');
    const saved = loadGame();
    if (saved) return resumeDuel(saved);
    return navigate('title');
  }

  if (name === 'deckbuilder') {
    showScreen('deckbuilder');
    openDeckBuilder({ onDecksChanged: () => renderDeckChoices() });
    return;
  }
  if (name === 'rules') {
    showScreen('rules');
    renderRules(document.getElementById('rules-body'));
    return;
  }

  // 不明なハッシュはタイトル扱い
  showScreen('title');
  renderResumeItem();
  renderSkinPicker();
}

window.addEventListener('hashchange', () => route(currentRoute()));

document.addEventListener('sbd:goto', (event) => navigate(event.detail));

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-goto]');
  if (!trigger) return;
  navigate(trigger.dataset.goto);
});

/* ------------------------------------------------------------------ *
 * 見た目
 * ------------------------------------------------------------------ */

function applySkin(key) {
  const skin = SKINS.find((s) => s.key === key) || SKINS[0];
  document.documentElement.dataset.skin = skin.key;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', skin.themeColor);
  renderSkinPicker();
}

function renderSkinPicker() {
  const bar = document.getElementById('skin-picker');
  if (!bar) return;
  const current = document.documentElement.dataset.skin;
  renderRadioBar(bar, SKINS.map((s) => [s.key, s.label]), current, (key) => {
    savePrefs({ skin: key });
    applySkin(key);
  });
}

/** 排他選択のボタン列を描く共通処理 */
function renderRadioBar(node, options, current, onPick) {
  node.replaceChildren();
  for (const [key, label] of options) {
    const btn = el('button', current === key ? 'is-on' : null, label);
    btn.type = 'button';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(current === key));
    btn.addEventListener('click', () => onPick(key));
    node.append(btn);
  }
}

/* ------------------------------------------------------------------ *
 * 中断した対戦の再開
 * ------------------------------------------------------------------ */

/** タイトルの「対戦を再開」を、保存があるときだけ出す */
function renderResumeItem() {
  const item = document.getElementById('menu-resume');
  const saved = loadGame();
  item.hidden = !saved;
  if (!saved) return;
  const { state, config } = saved;
  const names = state.players.map((p) => p.name).join(' vs ');
  const mode = config.mode === 'cpu' ? 'CPU対戦' : '2人対戦';
  document.getElementById('menu-resume-desc').textContent = `${mode} ／ ターン${state.turn} ／ ${names}`;
}

function resumeDuel(saved) {
  showScreen('duel');
  startDuel({
    ...saved.config,
    onExit: () => navigate('title'),
    resume: { state: saved.state, lastActive: saved.lastActive },
  });
}

/* ------------------------------------------------------------------ *
 * 対戦準備
 * ------------------------------------------------------------------ */

/** プリセットと保存デッキをまとめた、選択可能なデッキの一覧 */
function availableDecks() {
  const presets = PRESET_DECKS.map((d) => ({
    key: `preset:${d.id}`,
    name: d.name,
    description: d.description,
    recipe: d.recipe,
    civs: d.civs,
  }));
  const custom = loadDecks()
    .filter((d) => validateRecipe(d.recipe).ok)
    .map((d) => ({
      key: `custom:${d.id}`,
      name: d.name,
      description: '自分で作ったデッキ',
      recipe: d.recipe,
      civs: recipeCivs(d.recipe).slice(0, 2),
    }));
  return [...presets, ...custom];
}

function openSetup(mode) {
  setup.mode = mode;
  const prefs = loadPrefs();
  setup.difficulty = prefs.difficulty || 'normal';

  document.getElementById('setup-heading').textContent = mode === 'cpu' ? 'CPUと対戦' : '2人で対戦';
  document.getElementById('setup-p1-label').textContent = mode === 'cpu' ? 'あなた' : 'プレイヤー1';
  document.getElementById('setup-p2-label').textContent = mode === 'cpu' ? 'CPU' : 'プレイヤー2';
  document.getElementById('setup-difficulty-row').hidden = mode !== 'cpu';

  const decks = availableDecks();
  setup.deck[0] = setup.deck[0] && decks.some((d) => d.key === setup.deck[0])
    ? setup.deck[0] : (prefs.lastDeck && decks.some((d) => d.key === prefs.lastDeck)
      ? prefs.lastDeck : decks[0].key);
  setup.deck[1] = setup.deck[1] && decks.some((d) => d.key === setup.deck[1])
    ? setup.deck[1] : decks[1 % decks.length].key;

  renderDeckChoices();
  renderDifficulty();
  renderFirst();
  showScreen('setup');
}

function renderDeckChoices() {
  const decks = availableDecks();
  for (const side of [0, 1]) {
    const container = document.getElementById(`setup-deck-${side + 1}`);
    if (!container) continue;
    container.replaceChildren();
    for (const deck of decks) {
      const selected = setup.deck[side] === deck.key;
      const btn = el('button', `deckopt${selected ? ' is-selected' : ''}`);
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(selected));
      const name = el('div', 'deckopt__name');
      name.append(document.createTextNode(deck.name));
      const civs = el('span', 'deckopt__civs');
      for (const civ of deck.civs || []) {
        if (!CIVS[civ]) continue;
        const chip = el('i');
        chip.style.setProperty('--civ', `var(--civ-${civ})`);
        chip.title = `${CIVS[civ].name}文明`;
        civs.append(chip);
      }
      name.append(civs);
      btn.append(name);
      btn.append(el('div', 'deckopt__desc', deck.description));
      btn.addEventListener('click', () => {
        setup.deck[side] = deck.key;
        if (side === 0) savePrefs({ lastDeck: deck.key });
        renderDeckChoices();
      });
      container.append(btn);
    }
  }
}

function renderDifficulty() {
  const options = Object.entries(DIFFICULTIES).map(([key, info]) => [key, info.label]);
  renderRadioBar(document.getElementById('setup-difficulty'), options, setup.difficulty, (key) => {
    setup.difficulty = key;
    savePrefs({ difficulty: key });
    renderDifficulty();
  });
}

function renderFirst() {
  const options = [
    ['random', 'ランダム'],
    ['me', setup.mode === 'cpu' ? 'あなた' : 'プレイヤー1'],
    ['foe', setup.mode === 'cpu' ? 'CPU' : 'プレイヤー2'],
  ];
  renderRadioBar(document.getElementById('setup-first'), options, setup.first, (key) => {
    setup.first = key;
    renderFirst();
  });
}

/* ------------------------------------------------------------------ *
 * 対戦開始
 * ------------------------------------------------------------------ */

document.getElementById('btn-start-duel').addEventListener('click', () => {
  const decks = availableDecks();
  const pick = (key) => decks.find((d) => d.key === key) || decks[0];
  const deckA = pick(setup.deck[0]);
  const deckB = pick(setup.deck[1]);

  const firstPlayer = setup.first === 'random'
    ? undefined
    : (setup.first === 'me' ? 0 : 1);

  // 新しく始めるので、以前の中断データは上書きされる
  showScreen('duel');
  startDuel({
    mode: setup.mode,
    difficulty: setup.difficulty,
    firstPlayer,
    onExit: () => navigate('title'),
    players: [
      {
        name: setup.mode === 'cpu' ? 'あなた' : 'プレイヤー1',
        cards: expandDeck(deckA.recipe),
        controller: 'human',
      },
      {
        name: setup.mode === 'cpu' ? `CPU（${DIFFICULTIES[setup.difficulty].label}）` : 'プレイヤー2',
        cards: expandDeck(deckB.recipe),
        controller: setup.mode === 'cpu' ? 'cpu' : 'human',
      },
    ],
  });
  navigate('duel');
});

/* ------------------------------------------------------------------ *
 * 起動
 * ------------------------------------------------------------------ */

applySkin(loadPrefs().skin);
route(currentRoute());
