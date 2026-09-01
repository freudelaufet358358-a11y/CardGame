/**
 * 画面のルーティングと対戦準備。
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
      const btn = el('button', `deckopt${setup.deck[side] === deck.key ? ' is-selected' : ''}`);
      const name = el('div', 'deckopt__name');
      name.append(document.createTextNode(deck.name));
      for (const civ of deck.civs || []) {
        if (CIVS[civ]) name.append(el('span', null, CIVS[civ].emoji));
      }
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
  const bar = document.getElementById('setup-difficulty');
  bar.replaceChildren();
  for (const [key, info] of Object.entries(DIFFICULTIES)) {
    const btn = el('button', setup.difficulty === key ? 'is-on' : null, info.label);
    btn.addEventListener('click', () => {
      setup.difficulty = key;
      savePrefs({ difficulty: key });
      renderDifficulty();
    });
    bar.append(btn);
  }
}

function renderFirst() {
  const bar = document.getElementById('setup-first');
  bar.replaceChildren();
  const options = [
    ['random', 'ランダム'],
    ['me', setup.mode === 'cpu' ? 'あなた' : 'プレイヤー1'],
    ['foe', setup.mode === 'cpu' ? 'CPU' : 'プレイヤー2'],
  ];
  for (const [key, label] of options) {
    const btn = el('button', setup.first === key ? 'is-on' : null, label);
    btn.addEventListener('click', () => { setup.first = key; renderFirst(); });
    bar.append(btn);
  }
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

goto('title');
