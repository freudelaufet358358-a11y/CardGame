/**
 * 画面のルーティングと対戦準備、見た目（スキン）の切り替え。
 */

import { CIVS } from './data/cards.js';
import { PRESET_DECKS, expandDeck, recipeCivs, validateRecipe } from './data/decks.js';
import { DIFFICULTIES } from './ai/cpu.js';
import { startDuel, stopDuel } from './ui/duel.js';
import { openDeckBuilder } from './ui/deckbuilder.js';
import { renderRules } from './ui/rulesdoc.js';
import { loadDecks, loadPrefs, savePrefs } from './ui/storage.js';
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

function goto(name) {
  hidePeek();
  if (name !== 'duel') stopDuel();

  for (const [key, id] of Object.entries(SCREENS)) {
    document.getElementById(id).classList.toggle('is-active', key === name);
  }
  window.scrollTo(0, 0);

  if (name === 'deckbuilder') openDeckBuilder({ onDecksChanged: () => renderDeckChoices() });
  if (name === 'rules') renderRules(document.getElementById('rules-body'));
}

document.addEventListener('sbd:goto', (event) => goto(event.detail));

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-goto]');
  if (!trigger) return;
  const target = trigger.dataset.goto;
  if (target === 'setup-cpu') return openSetup('cpu');
  if (target === 'setup-hotseat') return openSetup('hotseat');
  goto(target);
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
  bar.replaceChildren();
  const current = document.documentElement.dataset.skin;
  for (const skin of SKINS) {
    const btn = el('button', current === skin.key ? 'is-on' : null, skin.label);
    btn.type = 'button';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(current === skin.key));
    btn.addEventListener('click', () => {
      savePrefs({ skin: skin.key });
      applySkin(skin.key);
    });
    bar.append(btn);
  }
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
  goto('setup');
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

  startDuel({
    mode: setup.mode,
    difficulty: setup.difficulty,
    firstPlayer,
    onExit: () => goto('title'),
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
  goto('duel');
});

/* ------------------------------------------------------------------ *
 * 起動
 * ------------------------------------------------------------------ */

applySkin(loadPrefs().skin);
goto('title');
