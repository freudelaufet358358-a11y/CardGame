/**
 * 自作デッキと設定の保存（localStorage）。
 *
 * プライベートウィンドウや保存拒否設定では localStorage の読み書き自体が
 * 例外を投げることがあるため、すべて try/catch で包み、失敗しても
 * ゲームが動き続けるようにしている。
 */

const DECKS_KEY = 'sbd.decks.v1';
const PREFS_KEY = 'sbd.prefs.v1';
const GAME_KEY = 'sbd.game.v1';

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** 保存済みデッキの一覧 [{id, name, recipe}] */
export function loadDecks() {
  const decks = readJSON(DECKS_KEY, []);
  return Array.isArray(decks) ? decks.filter((d) => d && d.name && d.recipe) : [];
}

/** 同名なら上書き、無ければ追加。保存できたかを返す。 */
export function saveDeck(name, recipe) {
  const decks = loadDecks();
  const index = decks.findIndex((d) => d.name === name);
  const entry = { id: `custom-${Date.now().toString(36)}`, name, recipe };
  if (index >= 0) entry.id = decks[index].id, decks[index] = entry;
  else decks.push(entry);
  return writeJSON(DECKS_KEY, decks) ? entry : null;
}

export function deleteDeck(id) {
  const decks = loadDecks().filter((d) => d.id !== id);
  return writeJSON(DECKS_KEY, decks);
}

export function loadPrefs() {
  return readJSON(PREFS_KEY, {});
}

export function savePrefs(patch) {
  writeJSON(PREFS_KEY, { ...loadPrefs(), ...patch });
}

/* ------------------------------------------------------------------ *
 * 進行中の対戦（リロードやブラウザの戻るで失われないように）
 * ------------------------------------------------------------------ */

/** @param {{config:object, state:object, lastActive:number, savedAt:number}} data */
export function saveGame(data) {
  return writeJSON(GAME_KEY, data);
}

/** 保存された進行中の対戦。決着済みや壊れたものは null */
export function loadGame() {
  const data = readJSON(GAME_KEY, null);
  if (!data || !data.state || !data.config || !Array.isArray(data.state.players)) return null;
  if (data.state.phase === 'gameover') return null;
  return data;
}

export function clearGame() {
  try {
    localStorage.removeItem(GAME_KEY);
  } catch {
    /* 保存できない環境では何もしない */
  }
}
