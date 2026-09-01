/**
 * 効果（effect descriptor）の解決。
 *
 * ここでは state を直接書き換えます。呼び出し側（rules.applyAction）が
 * すでに cloneState() 済みの状態を渡す約束になっています。
 */

import {
  cardOf, currentPower, logMsg, opponentOf, randomInt, removeFrom, toGrave,
} from './state.js';

/* ------------------------------------------------------------------ *
 * 対象の宣言と列挙
 * ------------------------------------------------------------------ */

/**
 * 効果ツリーを走査し、最初に見つかった「対象を要求するステップ」の仕様を返す。
 * 本作のカードは対象を取るステップを最大1つしか持たない設計にしている。
 */
export function targetSpecOf(effect) {
  if (!effect) return null;
  if (effect.op === 'sequence') {
    for (const step of effect.steps) {
      const spec = targetSpecOf(step);
      if (spec) return spec;
    }
    return null;
  }
  if (!effect.target) return null;
  return { target: effect.target, maxPower: effect.maxPower, maxCost: effect.maxCost };
}

/** 仕様に合致する対象の uid 一覧 */
export function legalTargets(state, controller, spec) {
  if (!spec) return [];
  const enemy = opponentOf(controller);

  if (spec.target === 'enemyCreature') {
    return state.players[enemy].field
      .filter((inst) => {
        if (spec.maxPower !== undefined && currentPower(inst) > spec.maxPower) return false;
        if (spec.maxCost !== undefined && cardOf(inst).cost > spec.maxCost) return false;
        return true;
      })
      .map((inst) => inst.uid);
  }
  if (spec.target === 'enemyTappedCreature') {
    return state.players[enemy].field
      .filter((inst) => inst.tapped)
      .map((inst) => inst.uid);
  }
  if (spec.target === 'ownGraveCreature') {
    return state.players[controller].grave
      .filter((inst) => cardOf(inst).type === 'creature')
      .map((inst) => inst.uid);
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * 基本操作
 * ------------------------------------------------------------------ */

/**
 * カードを引く。山札が尽きた状態で引こうとしたプレイヤーは敗北する。
 */
export function drawCards(state, playerIndex, n) {
  const player = state.players[playerIndex];
  for (let i = 0; i < n; i++) {
    if (player.deck.length === 0) {
      declareWinner(state, opponentOf(playerIndex), 'deckout');
      return;
    }
    const inst = player.deck.pop();
    resetInstance(inst);
    player.hand.push(inst);
  }
  logMsg(state, `${player.name} はカードを${n}枚引いた。`);
}

export function declareWinner(state, winner, reason) {
  if (state.winner !== null) return;
  state.winner = winner;
  state.winReason = reason;
  state.phase = 'gameover';
  state.pending = null;
  const text = reason === 'deckout'
    ? `${state.players[opponentOf(winner)].name} は山札が尽きた！ ${state.players[winner].name} の勝利！`
    : `${state.players[winner].name} のダイレクトアタック成功！ 勝利！`;
  logMsg(state, text, 'win');
}

/** 場から離れるカードの一時的な状態をリセットする */
export function resetInstance(inst) {
  inst.tapped = false;
  inst.position = 'attack';
  inst.powerBuff = 0;
  inst.posChangedThisTurn = false;
  inst.summonedTurn = -1;
}

/** クリーチャーを破壊して墓地へ送る */
export function destroyCreature(state, ownerIndex, uid) {
  const player = state.players[ownerIndex];
  const inst = removeFrom(player.field, uid);
  if (!inst) return false;
  logMsg(state, `${player.name} の「${cardOf(inst).name}」は破壊された。`, 'destroy');
  toGrave(state, ownerIndex, inst);
  return true;
}

/** クリーチャーを手札に戻す */
export function bounceCreature(state, ownerIndex, uid) {
  const player = state.players[ownerIndex];
  const inst = removeFrom(player.field, uid);
  if (!inst) return false;
  logMsg(state, `${player.name} の「${cardOf(inst).name}」は手札に戻った。`, 'bounce');
  resetInstance(inst);
  player.hand.push(inst);
  return true;
}

/** クリーチャーを持ち主のマナゾーンに置く（自然の除去） */
export function creatureToMana(state, ownerIndex, uid) {
  const player = state.players[ownerIndex];
  const inst = removeFrom(player.field, uid);
  if (!inst) return false;
  logMsg(state, `${player.name} の「${cardOf(inst).name}」はマナゾーンに置かれた。`, 'mana');
  resetInstance(inst);
  player.mana.push(inst);
  return true;
}

/** 山札の上から n 枚をマナゾーンに置く */
export function manaBoost(state, playerIndex, n) {
  const player = state.players[playerIndex];
  let moved = 0;
  for (let i = 0; i < n && player.deck.length > 0; i++) {
    const inst = player.deck.pop();
    resetInstance(inst);
    player.mana.push(inst);
    moved++;
  }
  if (moved > 0) logMsg(state, `${player.name} はマナゾーンにカードを${moved}枚追加した。`, 'mana');
}

/** 山札の上から n 枚を新しいシールドとして追加する */
export function addShields(state, playerIndex, n) {
  const player = state.players[playerIndex];
  let moved = 0;
  for (let i = 0; i < n && player.deck.length > 0; i++) {
    const inst = player.deck.pop();
    resetInstance(inst);
    player.shields.push(inst);
    moved++;
  }
  if (moved > 0) logMsg(state, `${player.name} はシールドを${moved}枚追加した。`, 'shield');
}

/**
 * パワーが0以下になったクリーチャーを破壊する（状況起因処理）。
 * パワー修整を伴う効果の直後に必ず呼ぶ。
 */
export function sweepZeroPower(state) {
  for (let p = 0; p < 2; p++) {
    const doomed = state.players[p].field.filter((inst) => currentPower(inst) <= 0);
    for (const inst of doomed) destroyCreature(state, p, inst.uid);
  }
}

/* ------------------------------------------------------------------ *
 * 効果の解決
 * ------------------------------------------------------------------ */

/**
 * 効果を解決する。
 * @param {object} state    書き換え対象の状態
 * @param {object} effect   effect descriptor
 * @param {object} ctx      { controller, targetUid, attackerUid, attackerOwner }
 * @returns {{negated: boolean}} 攻撃が無効化されたかどうか
 */
export function resolveEffect(state, effect, ctx) {
  const result = { negated: false };
  if (!effect) return result;
  applyOp(state, effect, ctx, result);
  sweepZeroPower(state);
  return result;
}

function applyOp(state, effect, ctx, result) {
  const me = ctx.controller;
  const enemy = opponentOf(me);

  switch (effect.op) {
    case 'sequence':
      for (const step of effect.steps) applyOp(state, step, ctx, result);
      break;

    case 'draw':
      drawCards(state, me, effect.n);
      break;

    case 'destroy': {
      if (!ctx.targetUid) break;
      destroyCreature(state, enemy, ctx.targetUid);
      break;
    }

    case 'bounce': {
      if (!ctx.targetUid) break;
      bounceCreature(state, enemy, ctx.targetUid);
      break;
    }

    case 'toMana': {
      if (!ctx.targetUid) break;
      creatureToMana(state, enemy, ctx.targetUid);
      break;
    }

    case 'tap': {
      if (!ctx.targetUid) break;
      const inst = state.players[enemy].field.find((i) => i.uid === ctx.targetUid);
      if (inst) {
        inst.tapped = true;
        logMsg(state, `「${cardOf(inst).name}」をタップした。`, 'tap');
      }
      break;
    }

    case 'tapAll': {
      const side = effect.side === 'self' ? me : enemy;
      for (const inst of state.players[side].field) inst.tapped = true;
      logMsg(state, `${state.players[side].name} のクリーチャーをすべてタップした。`, 'tap');
      break;
    }

    case 'untapAll': {
      const side = effect.side === 'self' ? me : enemy;
      for (const inst of state.players[side].field) inst.tapped = false;
      logMsg(state, `${state.players[side].name} のクリーチャーをすべてアンタップした。`, 'tap');
      break;
    }

    case 'manaBoost':
      manaBoost(state, me, effect.n);
      break;

    case 'addShield':
      addShields(state, me, effect.n);
      break;

    case 'buffAll':
    case 'debuffAll': {
      const side = effect.side === 'self' ? me : enemy;
      for (const inst of state.players[side].field) inst.powerBuff += effect.power;
      const sign = effect.power >= 0 ? `+${effect.power}` : `${effect.power}`;
      logMsg(state, `${state.players[side].name} のクリーチャーはこのターン、パワー${sign}。`, 'buff');
      break;
    }

    case 'discardRandom': {
      const target = state.players[enemy];
      for (let i = 0; i < effect.n && target.hand.length > 0; i++) {
        const idx = randomInt(state, target.hand.length);
        const [inst] = target.hand.splice(idx, 1);
        target.grave.push(inst);
        logMsg(state, `${target.name} は「${cardOf(inst).name}」を捨てた。`, 'discard');
      }
      break;
    }

    case 'graveToHand': {
      if (!ctx.targetUid) break;
      const inst = removeFrom(state.players[me].grave, ctx.targetUid);
      if (inst) {
        resetInstance(inst);
        state.players[me].hand.push(inst);
        logMsg(state, `${state.players[me].name} は墓地から「${cardOf(inst).name}」を手札に戻した。`);
      }
      break;
    }

    /* --- 罠専用（ctx.attackerUid / ctx.attackerOwner を使う） --- */

    case 'negateAttack': {
      result.negated = true;
      const owner = ctx.attackerOwner;
      const attacker = state.players[owner]?.field.find((i) => i.uid === ctx.attackerUid);
      if (effect.destroyAttacker && attacker) destroyCreature(state, owner, ctx.attackerUid);
      else if (effect.bounceAttacker && attacker) bounceCreature(state, owner, ctx.attackerUid);
      else if (effect.tapAttacker && attacker) attacker.tapped = true;
      if (effect.addShield) addShields(state, me, effect.addShield);
      logMsg(state, '攻撃は無効化された！', 'negate');
      break;
    }

    case 'debuffAttacker': {
      const attacker = state.players[ctx.attackerOwner]?.field.find((i) => i.uid === ctx.attackerUid);
      if (attacker) {
        attacker.powerBuff += effect.power;
        logMsg(state, `攻撃クリーチャーはこのターン、パワー${effect.power}。`, 'buff');
      }
      break;
    }

    default:
      throw new Error(`未実装の効果: ${effect.op}`);
  }
}
