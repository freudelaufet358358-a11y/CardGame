/**
 * デッキ定義とデッキ構築ルール。
 *
 * デッキは { cardId: 枚数 } の連想配列（レシピ）で表し、
 * 対戦開始時に expandDeck() で 40 枚のカードID配列へ展開します。
 */

import { getCard } from './cards.js';

export const DECK_SIZE = 40;
export const MAX_COPIES = 4;

export const PRESET_DECKS = [
  {
    id: 'preset-light-water',
    name: '蒼き城壁',
    civs: ['light', 'water'],
    description: 'ブロッカーで攻撃を受け止め、ドローで手札を伸ばして戦う防御型。じっくり戦いたい人向け。',
    recipe: {
      li01: 4, li02: 4, li03: 3, li04: 2, li05: 2, li06: 2, li07: 4, li08: 2,
      wa01: 2, wa03: 2, wa04: 3, wa06: 4, wa07: 2, wa08: 4,
    },
  },
  {
    id: 'preset-dark-fire',
    name: '業炎の侵略',
    civs: ['fire', 'dark'],
    description: 'スピードアタッカーで先手を取り、除去で盤面をこじ開けて一気に押し切る速攻型。短期決戦向け。',
    recipe: {
      fi01: 4, fi02: 4, fi03: 4, fi04: 2, fi05: 3, fi06: 3,
      da01: 4, da02: 3, da03: 3, da04: 2, da05: 2, da06: 2, da07: 2, da08: 2,
    },
  },
  {
    id: 'preset-nature-fire',
    name: '獣王の咆哮',
    civs: ['nature', 'fire'],
    description: 'マナ加速から大型クリーチャーを叩きつける展開型。決まったときの制圧力が最も高い。',
    recipe: {
      na01: 3, na02: 4, na03: 3, na04: 4, na05: 4, na06: 2, na07: 2,
      fi02: 4, fi03: 4, fi04: 2, fi05: 4, fi06: 4,
    },
  },
  {
    id: 'preset-light-dark',
    name: '粛清の秩序',
    civs: ['light', 'dark'],
    description: 'ブロッカーで守りつつ除去で相手の盤面を削り取るコントロール型。除去カードが最も多い。',
    recipe: {
      li01: 4, li02: 4, li03: 3, li04: 2, li05: 3, li06: 3, li07: 2, li08: 2,
      da02: 3, da03: 3, da04: 2, da05: 2, da06: 2, da07: 2, da08: 3,
    },
  },
];

/** レシピの合計枚数 */
export function recipeCount(recipe) {
  return Object.values(recipe).reduce((sum, n) => sum + n, 0);
}

/**
 * レシピを検証する。
 * @returns {{ok: boolean, errors: string[], count: number}}
 */
export function validateRecipe(recipe) {
  const errors = [];
  const count = recipeCount(recipe);

  if (count !== DECK_SIZE) {
    errors.push(`デッキはちょうど${DECK_SIZE}枚にしてください（現在${count}枚）`);
  }
  for (const [cardId, n] of Object.entries(recipe)) {
    if (!Number.isInteger(n) || n < 0) {
      errors.push(`${cardId} の枚数が不正です`);
      continue;
    }
    if (n > MAX_COPIES) {
      errors.push(`「${getCard(cardId).name}」は${MAX_COPIES}枚までです（現在${n}枚）`);
    }
  }
  return { ok: errors.length === 0, errors, count };
}

/** レシピを 40 要素のカードID配列へ展開する */
export function expandDeck(recipe) {
  const out = [];
  for (const [cardId, n] of Object.entries(recipe)) {
    for (let i = 0; i < n; i++) out.push(cardId);
  }
  return out;
}

/** レシピに含まれる文明の一覧（枚数の多い順） */
export function recipeCivs(recipe) {
  const counts = {};
  for (const [cardId, n] of Object.entries(recipe)) {
    const { civ } = getCard(cardId);
    counts[civ] = (counts[civ] || 0) + n;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([civ]) => civ);
}

/** マナカーブ（コスト -> 枚数）。コスト7以上は 7 にまとめる */
export function manaCurve(recipe) {
  const curve = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  for (const [cardId, n] of Object.entries(recipe)) {
    const cost = Math.min(7, Math.max(1, getCard(cardId).cost));
    curve[cost] += n;
  }
  return curve;
}

export function getPreset(id) {
  return PRESET_DECKS.find((d) => d.id === id) || null;
}
