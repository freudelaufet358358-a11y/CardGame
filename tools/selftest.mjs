#!/usr/bin/env node
/**
 * CPU 同士の自動対戦によるルールの回帰テスト。
 *
 *   node tools/selftest.mjs [試合数] [開始シード]
 *
 * ブラウザで動かしているのと完全に同じ ES モジュールを import して回すので、
 * ルールの穴・例外・無限ループ・カード枚数の不整合をここで潰せる。
 */

import { PRESET_DECKS, expandDeck, validateRecipe } from '../src/data/decks.js';
import { ALL_CARDS } from '../src/data/cards.js';
import { createGame, MAX_TURNS } from '../src/engine/state.js';
import { applyAction, describeAction, legalActions } from '../src/engine/rules.js';
import { chooseAction } from '../src/ai/cpu.js';

const games = Number(process.argv[2] || 300);
const baseSeed = Number(process.argv[3] || 12345);

let failures = 0;
function check(condition, message, context) {
  if (condition) return;
  failures++;
  console.error(`  ✗ ${message}`);
  if (context) console.error(`    ${context}`);
}

/* ------------------------------------------------------------------ *
 * 1. 静的な検証
 * ------------------------------------------------------------------ */

console.log('■ カードプールとプリセットデッキの検証');
console.log(`  カード種類数: ${ALL_CARDS.length}`);
check(ALL_CARDS.length === 40, `カードは40種のはず（実際 ${ALL_CARDS.length}）`);

for (const card of ALL_CARDS) {
  check(card.cost >= 1, `${card.name}: コストが不正`);
  check(['creature', 'spell', 'trap'].includes(card.type), `${card.name}: 種別が不正`);
  if (card.type === 'creature') {
    check(typeof card.power === 'number' && card.power > 0, `${card.name}: パワーが不正`);
    check(typeof card.guard === 'number' && card.guard >= 0, `${card.name}: ガードが不正`);
  } else {
    check(!!card.effect, `${card.name}: effect が無い`);
  }
  if (card.type === 'trap') check(!!card.trapTrigger, `${card.name}: trapTrigger が無い`);
}

for (const deck of PRESET_DECKS) {
  const result = validateRecipe(deck.recipe);
  check(result.ok, `プリセット「${deck.name}」が不正: ${result.errors.join(' / ')}`);
  console.log(`  ${deck.name}: ${result.count}枚 ${result.ok ? 'OK' : 'NG'}`);
}

/* ------------------------------------------------------------------ *
 * 2. 不変条件
 * ------------------------------------------------------------------ */

function totalCards(state, p) {
  const player = state.players[p];
  return player.deck.length + player.hand.length + player.mana.length
    + player.shields.length + player.field.length + player.traps.length + player.grave.length;
}

function assertInvariants(state, label) {
  for (let p = 0; p < 2; p++) {
    const player = state.players[p];
    check(totalCards(state, p) === 40,
      `${label}: P${p} のカード総数が40でない（${totalCards(state, p)}）`);
    check(player.field.length <= 5, `${label}: P${p} の場が5体を超えた`);
    check(player.traps.length <= 3, `${label}: P${p} の伏せカードが3枚を超えた`);
    for (const zone of ['deck', 'hand', 'mana', 'shields', 'field', 'traps', 'grave']) {
      check(player[zone].length >= 0, `${label}: P${p} の ${zone} が負`);
    }
  }
  const uids = new Set();
  for (let p = 0; p < 2; p++) {
    for (const zone of ['deck', 'hand', 'mana', 'shields', 'field', 'traps', 'grave']) {
      for (const inst of state.players[p][zone]) {
        check(!uids.has(inst.uid), `${label}: uid ${inst.uid} が重複している`);
        uids.add(inst.uid);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * 3. 自動対戦
 * ------------------------------------------------------------------ */

/** シード固定の乱数（CPU のノイズ用。テストを再現可能にする） */
function makeRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = Math.imul(s ^ (s >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

/** 4デッキの順序付き総当たり（ミラーは除く）。どのデッキも均等に先攻/後攻を担当する。 */
const MATCHUPS = [];
for (let a = 0; a < PRESET_DECKS.length; a++) {
  for (let b = 0; b < PRESET_DECKS.length; b++) {
    if (a !== b) MATCHUPS.push([a, b]);
  }
}

console.log(`\n■ CPU 同士の自動対戦 ${games} 戦`);
const reasons = { direct: 0, deckout: 0, timeout: 0 };
const deckWins = Object.fromEntries(PRESET_DECKS.map((d) => [d.name, { win: 0, play: 0 }]));
const firstPlayerWins = [0, 0];
let totalActions = 0;
let totalTurns = 0;
const start = Date.now();

for (let g = 0; g < games; g++) {
  const seed = baseSeed + g;
  const rand = makeRand(seed * 7919 + 13);
  const [ai, bi] = MATCHUPS[g % MATCHUPS.length];
  const deckA = PRESET_DECKS[ai];
  const deckB = PRESET_DECKS[bi];
  deckWins[deckA.name].play++;
  deckWins[deckB.name].play++;
  // 先攻はマッチアップ表と独立に切り替える（デッキと先攻を相関させない）
  const firstPlayer = Math.floor(g / MATCHUPS.length) % 2;

  let state = createGame({
    seed,
    firstPlayer,
    players: [
      { name: `CPU-A(${deckA.name})`, cards: expandDeck(deckA.recipe), controller: 'cpu' },
      { name: `CPU-B(${deckB.name})`, cards: expandDeck(deckB.recipe), controller: 'cpu' },
    ],
  });

  let steps = 0;
  const MAX_STEPS = 20000;
  let lastDesc = '(なし)';

  try {
    while (state.phase !== 'gameover' && steps < MAX_STEPS) {
      const actions = legalActions(state);
      check(actions.length > 0,
        `#${g} 合法手が0件になった`, `phase=${state.phase} turn=${state.turn}`);
      if (actions.length === 0) break;

      // バランス計測のため両者とも同じ強さにする（easy は別枠でスモークテストする）
      const action = chooseAction(state, 'normal', rand);
      check(!!action, `#${g} CPU が行動を選べなかった`);
      if (!action) break;

      lastDesc = describeAction(state, action);
      state = applyAction(state, action);
      steps++;
      if (steps % 25 === 0) assertInvariants(state, `#${g} step${steps}`);
    }
  } catch (err) {
    failures++;
    console.error(`  ✗ #${g} 例外: ${err.message}`);
    console.error(`    seed=${seed} turn=${state.turn} phase=${state.phase} 直前の手=${lastDesc}`);
    console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    continue;
  }

  assertInvariants(state, `#${g} 終了時`);
  check(steps < MAX_STEPS, `#${g} が ${MAX_STEPS} 手で決着しなかった（無限ループの疑い）`);
  check(state.phase === 'gameover', `#${g} が終局していない（phase=${state.phase}）`);
  check(state.turn <= MAX_TURNS + 1, `#${g} のターン数が上限を超えた（${state.turn}）`);

  reasons[state.winReason] = (reasons[state.winReason] || 0) + 1;
  if (state.winner !== null) {
    const winnerDeck = state.winner === 0 ? deckA : deckB;
    deckWins[winnerDeck.name].win++;
    if (state.winner === firstPlayer) firstPlayerWins[0]++; else firstPlayerWins[1]++;
  }
  totalActions += steps;
  totalTurns += state.turn;
}

const elapsed = Date.now() - start;

/* ------------------------------------------------------------------ *
 * 4. レポート
 * ------------------------------------------------------------------ */

console.log(`  平均ターン数   : ${(totalTurns / games).toFixed(1)}`);
console.log(`  平均行動数     : ${(totalActions / games).toFixed(1)}`);
console.log(`  所要時間       : ${elapsed}ms（1試合あたり ${(elapsed / games).toFixed(1)}ms）`);
console.log('  決着理由       :');
for (const [reason, count] of Object.entries(reasons)) {
  const label = { direct: 'ダイレクトアタック', deckout: '山札切れ', timeout: '規定ターン超過' }[reason] || reason;
  console.log(`    ${label}: ${count} (${((count / games) * 100).toFixed(1)}%)`);
}
console.log(`  先攻/後攻の勝利: ${firstPlayerWins[0]} / ${firstPlayerWins[1]}`);
console.log('  デッキ別勝率   :');
for (const [name, rec] of Object.entries(deckWins)) {
  const rate = rec.play ? ((rec.win / rec.play) * 100).toFixed(1) : '-';
  console.log(`    ${name.padEnd(6, '　')}: ${rec.win}/${rec.play} (${rate}%)`);
}

// バランスの目安：どのデッキも極端に偏っていないこと（警告のみ、失敗にはしない）
for (const [name, rec] of Object.entries(deckWins)) {
  if (!rec.play) continue;
  const rate = rec.win / rec.play;
  if (rate < 0.25 || rate > 0.75) {
    console.warn(`  ! バランス警告: 「${name}」の勝率が ${(rate * 100).toFixed(1)}% と偏っています`);
  }
}
check(reasons.timeout === undefined || reasons.timeout === 0,
  `規定ターン超過が ${reasons.timeout} 件（決着しない盤面がある）`);

/* ------------------------------------------------------------------ *
 * 5. 難易度「やさしい」のスモークテスト
 *    例外なく動き、かつ「ふつう」より確実に弱いことを確かめる。
 * ------------------------------------------------------------------ */

console.log('\n■ 難易度チェック（やさしい vs ふつう）');
const easyGames = Math.max(120, Math.floor(games / 4));
let easyWins = 0;
for (let g = 0; g < easyGames; g++) {
  const rand = makeRand(g * 2654435761 + 99);
  const [ai, bi] = MATCHUPS[g % MATCHUPS.length];
  let state = createGame({
    seed: baseSeed + 900000 + g,
    firstPlayer: g % 2,
    players: [
      { name: 'EASY', cards: expandDeck(PRESET_DECKS[ai].recipe), controller: 'cpu' },
      { name: 'NORMAL', cards: expandDeck(PRESET_DECKS[bi].recipe), controller: 'cpu' },
    ],
  });
  let steps = 0;
  while (state.phase !== 'gameover' && steps++ < 20000) {
    const action = chooseAction(state, state.priority === 0 ? 'easy' : 'normal', rand);
    if (!action) break;
    state = applyAction(state, action);
  }
  if (state.winner === 0) easyWins++;
}
const easyRate = (easyWins / easyGames) * 100;
console.log(`  やさしい側の勝率: ${easyWins}/${easyGames} (${easyRate.toFixed(1)}%)`);
check(easyRate < 45, `「やさしい」が弱くなっていない（勝率 ${easyRate.toFixed(1)}%）`);

console.log(failures === 0
  ? `\n✅ すべて成功（${games} 戦）`
  : `\n❌ ${failures} 件の問題が見つかりました`);
process.exit(failures === 0 ? 0 : 1);
