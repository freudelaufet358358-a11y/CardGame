/**
 * CPU の思考ルーチン。
 *
 * rules.legalActions() が返した合法手すべてに評価値を付け、最も高いものを選ぶ
 * 1手読みのヒューリスティック。難易度は評価値に乗せるノイズの大きさで表現する
 * （やさしい = ブレが大きく、たまに損な手を選ぶ）。
 */

import { hasKeyword } from '../data/cards.js';
import {
  blockValue, cardOf, currentPower, defenseValue, findInstance, opponentOf,
} from '../engine/state.js';
import { canPay, legalActions } from '../engine/rules.js';

/**
 * 難易度。
 * ノイズを増やすだけでは確実に弱くならなかった（評価値が僅かに負の攻撃が
 * ノイズで通り、結果的に強くなることがある）ため、「やさしい」は一定確率で
 * 合法手からランダムに選ぶ方式にしている。こちらは確実に弱くなる。
 */
export const DIFFICULTIES = {
  easy: { label: 'やさしい', noise: 8, randomChance: 0.45 },
  normal: { label: 'ふつう', noise: 3, randomChance: 0 },
};

const KEYWORD_VALUE = {
  blocker: 10,
  doubleBreaker: 16,
  speed: 9,
  slayer: 12,
  trigger: 6,
};

/** カード単体のおおまかな価値（手札の取捨選択に使う） */
function cardValue(card) {
  let value = card.cost * 6;
  if (card.type === 'creature') {
    value += card.power / 400;
    value += Math.max(card.guard - card.power, 0) / 800;
  } else {
    value += 14; // 呪文・罠は盤面に触るぶん少し高く見積もる
  }
  for (const kw of card.keywords || []) value += KEYWORD_VALUE[kw] || 0;
  return value;
}

/**
 * 山札切れの危険度。山札が薄いほどドローの価値を下げる。
 * これが無いと、ドローを積んだコントロール系デッキが自分の山札を掘り切って
 * 勝手に負ける（実測で敗因の3割強が山札切れだった）。
 */
function drawPenalty(player, drawCount) {
  const remaining = player.deck.length;
  if (remaining <= drawCount) return 1000; // 引いた瞬間に敗北
  if (remaining >= 16) return 0;
  return (16 - remaining) * (2.5 + drawCount);
}

/** 場に出ている敵クリーチャーの脅威度 */
function threatValue(inst) {
  const card = cardOf(inst);
  let value = currentPower(inst) / 400 + card.cost * 5;
  for (const kw of card.keywords) value += KEYWORD_VALUE[kw] || 0;
  if (inst.tapped) value *= 0.75; // 寝ているうちは怖くない
  return value;
}

/* ------------------------------------------------------------------ *
 * 攻撃の見積もり
 * ------------------------------------------------------------------ */

/**
 * 攻撃したときに相手がブロックしてくる可能性を踏まえて損得を見積もる。
 * @returns {{lossRisk:number, blockedByStrong:boolean}}
 */
function blockOutlook(state, me, attackerPower) {
  const enemy = opponentOf(me);
  let blockedByStrong = false;
  let bestTradeForEnemy = 0;

  for (const b of state.players[enemy].field) {
    if (!hasKeyword(cardOf(b), 'blocker') || b.tapped) continue;
    const bv = blockValue(b); // ブロックはガードの値で行われる
    if (bv > attackerPower) {
      blockedByStrong = true;
      bestTradeForEnemy = Math.max(bestTradeForEnemy, 30);
    } else if (bv === attackerPower) {
      bestTradeForEnemy = Math.max(bestTradeForEnemy, 12);
    }
  }
  return { lossRisk: bestTradeForEnemy, blockedByStrong };
}

/* ------------------------------------------------------------------ *
 * 評価
 * ------------------------------------------------------------------ */

function scoreAction(state, action) {
  const me = state.active;
  const enemy = opponentOf(me);
  const player = state.players[me];
  const foe = state.players[enemy];

  switch (action.type) {
    case 'endTurn':
      return 0;

    case 'charge': {
      const inst = player.hand.find((i) => i.uid === action.uid);
      const card = cardOf(inst);
      // マナは常に伸ばしたい。何を置くかで差を付ける。
      let score = 62;
      const civInMana = player.mana.some((m) => cardOf(m).civ === card.civ);
      const civInHand = player.hand.filter((i) => cardOf(i).civ === card.civ).length;
      if (!civInMana && civInHand > 1) score += 26; // 足りない文明を補充する
      if (civInHand === 1 && !civInMana) score -= 18; // 唯一の文明源は手札に残したくない
      const copies = player.hand.filter((i) => i.cardId === inst.cardId).length;
      if (copies > 1) score += 8;
      if (canPay(player, card) && card.cost <= player.mana.length) score -= 6;
      // 高コストのフィニッシャーをマナに埋めると勝ち手段を失う。
      // すでに唱えられる見込みがあるカードほど手札に残す。
      score -= cardValue(card) * 0.9;
      if (card.cost >= 6 && player.mana.length >= card.cost - 3) score -= 25;
      return score;
    }

    case 'play': {
      const inst = player.hand.find((i) => i.uid === action.uid);
      const card = cardOf(inst);
      if (card.type === 'creature') return scoreSummon(state, action, card);
      if (card.type === 'trap') {
        // 罠は余ったマナで伏せる。序盤に急いで伏せる必要はない。
        return 18 + (foe.field.length > 0 ? 8 : 0);
      }
      return scoreSpell(state, action, card);
    }

    case 'changePosition': {
      const inst = player.field.find((i) => i.uid === action.uid);
      const card = cardOf(inst);
      if (inst.position === 'attack') {
        // 守備向きのクリーチャーで、シールドが減っているときだけ寝かせる
        const defensive = card.guard > card.power;
        return defensive && player.shields.length <= 2 ? 14 : -20;
      }
      // 守備 -> 攻撃は、殴り返せる盤面のときだけ
      return card.power >= 4000 && foe.field.length === 0 ? 12 : -15;
    }

    case 'attack':
      return scoreAttack(state, action);

    /* --- 防御側 --- */
    case 'activateTrap':
      return scoreTrap(state);
    case 'block':
      return scoreBlock(state, action);
    case 'pass':
      return 0;

    /* --- シールドトリガー --- */
    case 'useTrigger': {
      const inst = state.players[state.priority].hand.find((i) => i.uid === action.uid);
      const effect = inst ? cardOf(inst).effect : null;
      const penalty = effect?.op === 'draw'
        ? drawPenalty(state.players[state.priority], effect.n) : 0;
      return 50 + targetBonus(state, action) - penalty;
    }
    case 'skipTrigger':
      return 0;

    default:
      return 0;
  }
}

/** 対象を取る行動で、より強い相手を狙うほど高くする */
function targetBonus(state, action) {
  if (!action.targetUid) return 0;
  const found = findInstance(state, action.targetUid);
  if (!found) return 0;
  if (found.zone === 'field') return threatValue(found.inst);
  if (found.zone === 'grave') return cardValue(cardOf(found.inst)) * 0.6;
  return 0;
}

function scoreSummon(state, action, card) {
  const me = state.active;
  const player = state.players[me];
  const foe = state.players[opponentOf(me)];

  let score = 34 + card.cost * 3 + card.power / 700;
  for (const kw of card.keywords) score += KEYWORD_VALUE[kw] || 0;
  score += targetBonus(state, action) * 0.9; // 召喚時効果の対象価値
  if (card.onSummon?.op === 'draw') score -= drawPenalty(player, card.onSummon.n);

  const behindOnBoard = foe.field.length > player.field.length;
  const lowShields = player.shields.length <= 2;

  if (action.position === 'defense') {
    // ブロッカーは攻撃表示のままでもガードの値でブロックできる。
    // わざわざ守備表示にすると「攻撃対象にされる」デメリットだけが残る。
    if (hasKeyword(card, 'blocker')) return -100;
    const defensive = card.guard >= card.power;
    score += defensive ? 6 : -14;
    score += (behindOnBoard || lowShields) ? 10 : -8;
    if (hasKeyword(card, 'speed')) score -= 12; // 速攻持ちを寝かせるのは損
  } else {
    score += hasKeyword(card, 'speed') ? 10 : 0;
    score += (behindOnBoard || lowShields) ? -4 : 6;
  }
  return score;
}

function scoreSpell(state, action, card) {
  const me = state.active;
  const player = state.players[me];
  const foe = state.players[opponentOf(me)];
  const effect = card.effect || {};
  let score = 20;

  switch (effect.op) {
    case 'draw':
      score += effect.n * 13;
      if (player.hand.length <= 2) score += 12;
      score -= drawPenalty(player, effect.n);
      break;
    case 'destroy':
      score += targetBonus(state, action) * 1.2;
      break;
    case 'toMana':
      // 破壊と同等の除去。ただし相手のマナが1枚増えるぶん少しだけ割り引く。
      score += targetBonus(state, action) * 1.1;
      break;
    case 'bounce':
      // 手札に戻すだけなので再展開される。除去としては一段劣る。
      score += targetBonus(state, action) * 0.85;
      break;
    case 'manaBoost':
      score += effect.n * 16;
      if (player.mana.length >= 8) score -= 30; // 十分伸びたら不要
      break;
    case 'addShield':
      score += 12 + (player.shields.length <= 2 ? 22 : 0);
      break;
    case 'tapAll':
      score += foe.field.filter((i) => !i.tapped).length * 12;
      break;
    case 'untapAll':
      score += player.field.filter((i) => i.tapped && i.position === 'attack').length * 16;
      break;
    case 'buffAll':
      score += player.field.filter((i) => !i.tapped && i.position === 'attack').length * 10;
      break;
    case 'debuffAll':
      // -3000 で焼ける相手が多いほど価値がある
      score += foe.field.filter((i) => currentPower(i) + effect.power <= 0).length * 26;
      score += foe.field.length * 4;
      break;
    case 'discardRandom':
      score += foe.hand.length > 0 ? 14 : -30;
      break;
    case 'sequence':
      score += 18 + targetBonus(state, action);
      break;
    default:
      break;
  }
  return score;
}

function scoreAttack(state, action) {
  const me = state.active;
  const enemy = opponentOf(me);
  const player = state.players[me];
  const foe = state.players[enemy];
  const attacker = player.field.find((i) => i.uid === action.uid);
  const power = currentPower(attacker);
  const attackerLoss = threatValue(attacker);
  const outlook = blockOutlook(state, me, power);
  const trapFear = foe.traps.length * 7;

  // 攻撃するとタップされるので、ブロッカーで殴るのは壁を1枚どけるのと同じ。
  // 相手に攻め手が残っていて、こちらのシールドが少ないなら殴らず立たせておく。
  let blockerCost = 0;
  if (hasKeyword(cardOf(attacker), 'blocker')) {
    const pressure = foe.field.filter((i) => i.position === 'attack').length;
    const otherBlockers = player.field.filter(
      (i) => i.uid !== attacker.uid && !i.tapped && hasKeyword(cardOf(i), 'blocker'),
    ).length;
    if (pressure > otherBlockers) {
      blockerCost = 14 + (player.shields.length <= 2 ? 20 : 0) + blockValue(attacker) / 500;
    }
  }

  if (action.target.kind === 'player') {
    // シールドが0ならこの攻撃が決定打
    if (foe.shields.length === 0) return 10000;

    let score = 46;
    if (hasKeyword(cardOf(attacker), 'doubleBreaker')) score += 14;
    if (foe.shields.length <= 2) score += 16; // 詰めに入る
    score -= trapFear + blockerCost;
    if (outlook.blockedByStrong) score -= attackerLoss + 24;
    else score -= outlook.lossRisk;
    return score;
  }

  const target = foe.field.find((i) => i.uid === action.target.uid);
  if (!target) return -999;
  const dv = defenseValue(target);
  const gain = threatValue(target);

  let score;
  if (hasKeyword(cardOf(attacker), 'slayer')) {
    // スレイヤーは相打ち前提で、より重い相手を討ち取れるほど得
    score = 24 + gain - attackerLoss * (power > dv ? 0 : 0.7);
  } else if (power > dv) {
    score = 30 + gain; // 一方的に討ち取れる
  } else if (power === dv && target.position === 'attack') {
    score = 6 + gain - attackerLoss; // 相打ち
  } else {
    score = -40; // 返り討ち
  }
  score -= trapFear + blockerCost;
  if (outlook.blockedByStrong) score -= attackerLoss + 20;
  return score;
}

function scoreTrap(state) {
  const defender = state.priority;
  const me = state.players[defender];
  const pending = state.pending;
  const attacker = state.players[pending.attackerOwner].field
    .find((i) => i.uid === pending.attackerUid);
  if (!attacker) return -100;

  const power = currentPower(attacker);
  const threat = threatValue(attacker);

  if (pending.target.kind === 'player') {
    // シールド0で受けたら敗北。絶対に止める。
    if (me.shields.length === 0) return 10000;
    let score = 12 + threat * 0.8;
    if (me.shields.length <= 2) score += 30;
    if (hasKeyword(cardOf(attacker), 'doubleBreaker')) score += 16;
    return score;
  }

  // クリーチャーへの攻撃。守るべき価値があるときだけ発動する。
  const target = me.field.find((i) => i.uid === pending.target.uid);
  if (!target) return -100;
  const wouldDie = power > defenseValue(target)
    || hasKeyword(cardOf(attacker), 'slayer');
  return wouldDie ? threatValue(target) * 0.9 : -30;
}

function scoreBlock(state, action) {
  const defender = state.priority;
  const me = state.players[defender];
  const pending = state.pending;
  const blocker = me.field.find((i) => i.uid === action.uid);
  const attacker = state.players[pending.attackerOwner].field
    .find((i) => i.uid === pending.attackerUid);
  if (!blocker || !attacker) return -100;

  const power = currentPower(attacker);
  const bv = blockValue(blocker);
  const attackerSlayer = hasKeyword(cardOf(attacker), 'slayer');
  const blockerDies = power >= bv || attackerSlayer;
  const attackerDies = bv >= power || hasKeyword(cardOf(blocker), 'slayer');

  // シールド0なら受けたら負け。何を犠牲にしてもブロックする。
  if (pending.target.kind === 'player' && me.shields.length === 0) return 9000;

  let score = 0;
  if (attackerDies) score += threatValue(attacker);
  if (blockerDies) score -= threatValue(blocker);
  if (pending.target.kind === 'player') {
    score += 10; // シールドを守る価値
    if (me.shields.length <= 2) score += 14;
  }
  return score;
}

/* ------------------------------------------------------------------ *
 * 公開API
 * ------------------------------------------------------------------ */

/**
 * CPU が選ぶ行動を返す。合法手が無い場合は null。
 * @param {object} state
 * @param {'easy'|'normal'} difficulty
 * @param {() => number} [rand] 0..1 の乱数（省略時 Math.random）
 */
export function chooseAction(state, difficulty = 'normal', rand = Math.random) {
  const actions = legalActions(state);
  if (actions.length === 0) return null;

  const config = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
  if (config.randomChance > 0 && rand() < config.randomChance) {
    return actions[Math.floor(rand() * actions.length)];
  }

  const { noise } = config;
  let best = null;
  let bestScore = -Infinity;
  for (const action of actions) {
    const score = scoreAction(state, action) + (rand() - 0.5) * 2 * noise;
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }

  // どの選択肢も損なら、手番なら終了、防御中なら何もしない
  if (bestScore <= 0) {
    const fallback = actions.find((a) => a.type === 'endTurn' || a.type === 'pass'
      || a.type === 'skipTrigger');
    if (fallback) return fallback;
  }
  return best;
}

/** 「なぜその手を選んだか」をUIに出したいとき用 */
export function explain(state, action) {
  return scoreAction(state, action);
}
