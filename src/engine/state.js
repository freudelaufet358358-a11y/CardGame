/**
 * ゲーム状態の生成とユーティリティ。
 *
 * 状態はプレーンオブジェクトのみで構成し（クラス・関数・Map を含めない）、
 * structuredClone でそのまま複製できるようにしています。
 * これにより rules.applyAction() を「元の状態を壊さない純粋関数」として書けます。
 */

import { getCard, hasKeyword } from '../data/cards.js';

export const INITIAL_SHIELDS = 5;
export const INITIAL_HAND = 5;
export const MAX_FIELD = 5;
export const MAX_TRAPS = 3;
export const MAX_TURNS = 100; // 無限ループ検出用のセーフティ

/* ------------------------------------------------------------------ *
 * 乱数（シード固定・再現可能）
 * ------------------------------------------------------------------ */

/** mulberry32。state に数値1つだけ持てばよいので複製が容易。 */
export function nextRandom(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomInt(state, n) {
  return Math.floor(nextRandom(state) * n);
}

/** Fisher-Yates。配列を破壊的にシャッフルする（state.rng を進める）。 */
export function shuffle(state, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(state, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ------------------------------------------------------------------ *
 * カードインスタンス
 * ------------------------------------------------------------------ */

let uidCounter = 0;

/** 場に存在する1枚のカード。cardId で定義を引く。 */
function makeInstance(cardId) {
  return {
    uid: `c${++uidCounter}`,
    cardId,
    tapped: false,
    position: 'attack', // 'attack' | 'defense'（クリーチャーのみ意味を持つ）
    summonedTurn: -1,
    posChangedThisTurn: false,
    powerBuff: 0, // このターン限りのパワー修整
  };
}

/** インスタンスからカード定義を引く */
export function cardOf(inst) {
  return getCard(inst.cardId);
}

/** 修整込みの現在パワー */
export function currentPower(inst) {
  return cardOf(inst).power + inst.powerBuff;
}

/** 攻撃を受けたときに参照される値（攻撃表示=パワー / 守備表示=ガード） */
export function defenseValue(inst) {
  const card = cardOf(inst);
  return inst.position === 'defense' ? card.guard + inst.powerBuff : currentPower(inst);
}

/**
 * ブロックしたときに戦う値。
 * ブロックは守りの行動なので、表示形式にかかわらずガードの値を使う。
 * （こうしないと「パワーは低いがガードは高い」防御型クリーチャーが
 *   攻撃表示のままではまったく壁にならず、除去を持つ文明だけが強くなる）
 */
export function blockValue(inst) {
  return cardOf(inst).guard + inst.powerBuff;
}

/** 召喚酔いしているか */
export function isSummoningSick(state, inst) {
  if (hasKeyword(cardOf(inst), 'speed')) return false;
  return inst.summonedTurn === state.turn;
}

/* ------------------------------------------------------------------ *
 * 初期状態
 * ------------------------------------------------------------------ */

function makePlayer(name, deckCardIds, controller) {
  return {
    name,
    controller, // 'human' | 'cpu'
    deck: deckCardIds.map(makeInstance),
    hand: [],
    mana: [],
    shields: [],
    field: [],
    traps: [],
    grave: [],
    chargedThisTurn: false,
  };
}

/**
 * 新しい対戦を作る。
 * @param {object} opts
 * @param {{name:string, cards:string[], controller:'human'|'cpu'}[]} opts.players 2人分
 * @param {number} [opts.seed] 乱数シード
 * @param {number} [opts.firstPlayer] 先攻プレイヤー（省略時ランダム）
 */
export function createGame({ players, seed = Date.now() >>> 0, firstPlayer }) {
  const state = {
    rng: seed >>> 0,
    seed: seed >>> 0,
    players: players.map((p) => makePlayer(p.name, p.cards, p.controller)),
    turn: 0,
    active: 0, // ターンプレイヤー
    priority: 0, // いま行動を選ぶプレイヤー
    phase: 'main', // 'main' | 'defend' | 'trigger' | 'gameover'
    pending: null, // 進行中の攻撃 / トリガー処理
    winner: null,
    winReason: null,
    log: [],
    lastEvent: null, // UI の演出用
  };

  for (const player of state.players) {
    shuffle(state, player.deck);
    for (let i = 0; i < INITIAL_SHIELDS; i++) player.shields.push(player.deck.pop());
    for (let i = 0; i < INITIAL_HAND; i++) player.hand.push(player.deck.pop());
  }

  state.active = firstPlayer !== undefined ? firstPlayer : randomInt(state, 2);
  state.priority = state.active;
  state.turn = 1;
  state.players[state.active].chargedThisTurn = false;
  logMsg(state, `${state.players[state.active].name} の先攻でデュエル開始！`, 'turn');
  logMsg(state, `--- ターン1: ${state.players[state.active].name} のターン ---`, 'turn');
  return state;
}

/* ------------------------------------------------------------------ *
 * ログ
 * ------------------------------------------------------------------ */

export function logMsg(state, text, kind = 'info') {
  state.log.push({ turn: state.turn, text, kind });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

/* ------------------------------------------------------------------ *
 * 複製
 * ------------------------------------------------------------------ */

/** 状態を安全に複製する（applyAction は必ずこれを通してから書き換える） */
export function cloneState(state) {
  return structuredClone(state);
}

/* ------------------------------------------------------------------ *
 * 探索ヘルパー
 * ------------------------------------------------------------------ */

export function opponentOf(playerIndex) {
  return playerIndex === 0 ? 1 : 0;
}

const ZONES = ['field', 'hand', 'mana', 'shields', 'traps', 'grave', 'deck'];

/** 全ゾーンから uid で検索する。見つからなければ null。 */
export function findInstance(state, uid) {
  for (let p = 0; p < 2; p++) {
    for (const zone of ZONES) {
      const idx = state.players[p][zone].findIndex((i) => i.uid === uid);
      if (idx >= 0) return { inst: state.players[p][zone][idx], player: p, zone, index: idx };
    }
  }
  return null;
}

/** ゾーンから uid のカードを取り除いて返す */
export function removeFrom(zone, uid) {
  const idx = zone.findIndex((i) => i.uid === uid);
  if (idx < 0) return null;
  return zone.splice(idx, 1)[0];
}

/** 場に出ているクリーチャーの状態を初期化して墓地へ送る */
export function toGrave(state, playerIndex, inst) {
  inst.tapped = false;
  inst.position = 'attack';
  inst.powerBuff = 0;
  inst.posChangedThisTurn = false;
  inst.summonedTurn = -1;
  state.players[playerIndex].grave.push(inst);
}
