/**
 * ルール本体。
 *
 * 公開APIは実質この2つだけ:
 *   legalActions(state) -> その時点で priority を持つプレイヤーが選べる行動の配列
 *   applyAction(state, action) -> 行動を適用した「新しい」状態
 *
 * UI・CPU・セルフテストがすべてこのAPIを通るため、
 * 「CPU対戦」と「2人交互プレイ」の違いは CPU の手番を自動で流すかどうかだけになる。
 */

import { hasKeyword, TRAP_TRIGGER_ON_ATTACK } from '../data/cards.js';
import {
  MAX_FIELD, MAX_TRAPS, MAX_TURNS,
  blockValue, cardOf, cloneState, currentPower, defenseValue, findInstance,
  isSummoningSick, logMsg, opponentOf, removeFrom,
} from './state.js';
import {
  declareWinner, destroyCreature, drawCards, legalTargets,
  resetInstance, resolveEffect, sweepZeroPower, targetSpecOf,
} from './effects.js';

/* ================================================================== *
 * マナ
 * ================================================================== */

/** そのカードのコストを支払えるか（コスト分のマナ＋自分の文明のマナ1つ以上） */
export function canPay(player, card) {
  const untapped = player.mana.filter((m) => !m.tapped);
  if (untapped.length < card.cost) return false;
  if (card.cost === 0) return true;
  return untapped.some((m) => cardOf(m).civ === card.civ);
}

/**
 * コストを支払う（マナをタップする）。
 * どのマナをタップするかは自動選択。同じ文明のマナが多く残っているものから
 * 優先して寝かせ、少数派の文明のマナを温存する。
 */
function payMana(player, card) {
  const untapped = player.mana.filter((m) => !m.tapped);
  const civCount = {};
  for (const m of untapped) {
    const civ = cardOf(m).civ;
    civCount[civ] = (civCount[civ] || 0) + 1;
  }
  const abundance = (m) => civCount[cardOf(m).civ] || 0;

  // 必要文明のマナを1枚確保
  const required = untapped
    .filter((m) => cardOf(m).civ === card.civ)
    .sort((a, b) => abundance(b) - abundance(a))[0];
  const chosen = [required];

  const rest = untapped
    .filter((m) => m !== required)
    .sort((a, b) => abundance(b) - abundance(a) || cardOf(a).cost - cardOf(b).cost);
  for (let i = 0; chosen.length < card.cost; i++) chosen.push(rest[i]);

  for (const m of chosen) m.tapped = true;
}

/* ================================================================== *
 * 合法手の列挙
 * ================================================================== */

/** 行動をUI/重複排除用の安定した文字列にする */
export function actionKey(action) {
  const parts = [action.type, action.uid || '', action.targetUid || '', action.position || ''];
  if (action.target) parts.push(action.target.kind, action.target.uid || '');
  return parts.join('|');
}

export function legalActions(state) {
  if (state.phase === 'gameover') return [];
  if (state.phase === 'defend') return defendActions(state);
  if (state.phase === 'trigger') return triggerActions(state);
  return mainActions(state);
}

function mainActions(state) {
  const me = state.active;
  const player = state.players[me];
  const actions = [];

  // チャージ（1ターン1回）
  if (!player.chargedThisTurn) {
    for (const inst of player.hand) {
      actions.push({ type: 'charge', uid: inst.uid });
    }
  }

  // カードをプレイ
  for (const inst of player.hand) {
    const card = cardOf(inst);
    if (!canPay(player, card)) continue;

    if (card.type === 'creature') {
      if (player.field.length >= MAX_FIELD) continue;
      const spec = targetSpecOf(card.onSummon);
      const targets = spec ? legalTargets(state, me, spec) : [];
      // 対象がなくても召喚自体はできる（効果だけ不発）
      const targetChoices = spec && targets.length > 0 ? targets : [null];
      for (const position of ['attack', 'defense']) {
        for (const targetUid of targetChoices) {
          actions.push({ type: 'play', uid: inst.uid, position, targetUid });
        }
      }
    } else if (card.type === 'spell') {
      const spec = targetSpecOf(card.effect);
      const targets = spec ? legalTargets(state, me, spec) : [];
      // 対象を取る呪文は、対象がないなら唱えられない
      if (spec && targets.length === 0) continue;
      const targetChoices = spec ? targets : [null];
      for (const targetUid of targetChoices) {
        actions.push({ type: 'play', uid: inst.uid, targetUid });
      }
    } else if (card.type === 'trap') {
      if (player.traps.length >= MAX_TRAPS) continue;
      actions.push({ type: 'play', uid: inst.uid, targetUid: null });
    }
  }

  // 表示形式の変更（タップ済み・召喚したターン・1ターンに2回は不可）
  for (const inst of player.field) {
    if (inst.tapped || inst.posChangedThisTurn) continue;
    if (inst.summonedTurn === state.turn) continue;
    actions.push({ type: 'changePosition', uid: inst.uid });
  }

  // 攻撃
  const enemy = opponentOf(me);
  for (const inst of player.field) {
    if (!canAttack(state, inst)) continue;
    actions.push({ type: 'attack', uid: inst.uid, target: { kind: 'player' } });
    for (const foe of state.players[enemy].field) {
      if (!canBeAttacked(foe)) continue;
      actions.push({ type: 'attack', uid: inst.uid, target: { kind: 'creature', uid: foe.uid } });
    }
  }

  actions.push({ type: 'endTurn' });
  return actions;
}

/**
 * 攻撃はクリーチャーをタップして行う。よって「タップされていないこと」が
 * そのまま攻撃回数の制限になる（アンタップさせる効果は再攻撃を可能にする）。
 */
export function canAttack(state, inst) {
  return inst.position === 'attack'
    && !inst.tapped
    && !isSummoningSick(state, inst);
}

/**
 * 攻撃対象にできるクリーチャーの条件。
 * 攻撃表示で立っている（アンタップの）クリーチャーは正面から殴れない。
 * つまり盤面のクリーチャーを処理する手段は「相手が攻撃してタップした隙を突く」
 * 「守備表示を狙う」「除去呪文を使う」の3つに限られ、盤面を作る価値が生まれる。
 */
export function canBeAttacked(inst) {
  return inst.tapped || inst.position === 'defense';
}

function defendActions(state) {
  const defender = state.priority;
  const player = state.players[defender];
  const actions = [];

  for (const trap of player.traps) {
    const card = cardOf(trap);
    if (card.trapTrigger !== TRAP_TRIGGER_ON_ATTACK) continue;
    actions.push({ type: 'activateTrap', uid: trap.uid });
  }

  const attackTargetUid = state.pending.target.kind === 'creature' ? state.pending.target.uid : null;
  for (const inst of player.field) {
    if (!hasKeyword(cardOf(inst), 'blocker')) continue;
    if (inst.tapped) continue;
    if (inst.uid === attackTargetUid) continue; // 攻撃対象自身をブロックしても意味がない
    actions.push({ type: 'block', uid: inst.uid });
  }

  actions.push({ type: 'pass' });
  return actions;
}

function triggerActions(state) {
  const owner = state.priority;
  const uid = state.pending.queue[0];
  const inst = state.players[owner].hand.find((i) => i.uid === uid);
  if (!inst) return [{ type: 'skipTrigger', uid }];

  const card = cardOf(inst);
  const spec = targetSpecOf(card.effect);
  const targets = spec ? legalTargets(state, owner, spec) : [];
  const actions = [];
  if (!spec || targets.length > 0) {
    for (const targetUid of spec ? targets : [null]) {
      actions.push({ type: 'useTrigger', uid, targetUid });
    }
  }
  actions.push({ type: 'skipTrigger', uid });
  return actions;
}

/* ================================================================== *
 * 行動の適用
 * ================================================================== */

/**
 * 行動を適用して新しい状態を返す。元の state は書き換えない。
 */
export function applyAction(state, action) {
  const next = cloneState(state);
  next.lastEvent = null;
  perform(next, action);
  return next;
}

function perform(state, action) {
  switch (action.type) {
    case 'charge': return doCharge(state, action);
    case 'play': return doPlay(state, action);
    case 'changePosition': return doChangePosition(state, action);
    case 'attack': return doAttack(state, action);
    case 'endTurn': return endTurn(state);
    case 'activateTrap': return doActivateTrap(state, action);
    case 'block': return doBlock(state, action);
    case 'pass': return resolveAttack(state);
    case 'useTrigger': return doUseTrigger(state, action);
    case 'skipTrigger': return doSkipTrigger(state, action);
    default: throw new Error(`未知の行動: ${action.type}`);
  }
}

function doCharge(state, action) {
  const player = state.players[state.active];
  const inst = removeFrom(player.hand, action.uid);
  if (!inst) throw new Error('チャージ対象が手札にない');
  resetInstance(inst);
  player.mana.push(inst);
  player.chargedThisTurn = true;
  logMsg(state, `${player.name} は「${cardOf(inst).name}」をマナゾーンに置いた。`, 'mana');
  state.lastEvent = { type: 'charge', player: state.active };
}

function doPlay(state, action) {
  const me = state.active;
  const player = state.players[me];
  const inst = player.hand.find((i) => i.uid === action.uid);
  if (!inst) throw new Error('プレイ対象が手札にない');
  const card = cardOf(inst);
  if (!canPay(player, card)) throw new Error('マナが足りない');

  payMana(player, card);
  removeFrom(player.hand, action.uid);

  if (card.type === 'creature') {
    resetInstance(inst);
    inst.position = action.position === 'defense' ? 'defense' : 'attack';
    inst.summonedTurn = state.turn;
    player.field.push(inst);
    const posText = inst.position === 'defense' ? '守備表示' : '攻撃表示';
    logMsg(state, `${player.name} は「${card.name}」を${posText}で召喚した。`, 'summon');
    state.lastEvent = { type: 'summon', player: me, uid: inst.uid };
    if (card.onSummon) {
      resolveEffect(state, card.onSummon, { controller: me, targetUid: action.targetUid });
    }
  } else if (card.type === 'spell') {
    logMsg(state, `${player.name} は呪文「${card.name}」を唱えた。`, 'spell');
    state.lastEvent = { type: 'spell', player: me, cardId: card.id };
    resolveEffect(state, card.effect, { controller: me, targetUid: action.targetUid });
    player.grave.push(inst);
  } else if (card.type === 'trap') {
    resetInstance(inst);
    player.traps.push(inst);
    logMsg(state, `${player.name} はカードを1枚伏せた。`, 'set');
    state.lastEvent = { type: 'set', player: me };
  }
  checkGameOver(state);
}

function doChangePosition(state, action) {
  const player = state.players[state.active];
  const inst = player.field.find((i) => i.uid === action.uid);
  if (!inst) throw new Error('表示形式を変更するクリーチャーがいない');
  inst.position = inst.position === 'attack' ? 'defense' : 'attack';
  inst.posChangedThisTurn = true;
  const posText = inst.position === 'defense' ? '守備表示' : '攻撃表示';
  logMsg(state, `${player.name} は「${cardOf(inst).name}」を${posText}に変更した。`);
}

/* ------------------------------- 攻撃 ------------------------------- */

function doAttack(state, action) {
  const me = state.active;
  const player = state.players[me];
  const attacker = player.field.find((i) => i.uid === action.uid);
  if (!attacker) throw new Error('攻撃クリーチャーがいない');
  if (!canAttack(state, attacker)) throw new Error('このクリーチャーは攻撃できない');

  attacker.tapped = true;

  const targetName = action.target.kind === 'player'
    ? `${state.players[opponentOf(me)].name} のシールド`
    : `「${cardOf(findInstance(state, action.target.uid).inst).name}」`;
  logMsg(state, `${player.name} の「${cardOf(attacker).name}」が ${targetName} を攻撃！`, 'attack');

  state.pending = {
    kind: 'attack',
    attackerUid: attacker.uid,
    attackerOwner: me,
    target: action.target,
  };
  state.phase = 'defend';
  state.priority = opponentOf(me);
  state.lastEvent = { type: 'attack', player: me, uid: attacker.uid };

  autoResolveDefendIfIdle(state);
}

/** 防御側に選択肢（罠・ブロッカー）が無ければ、待たずに攻撃を解決する */
function autoResolveDefendIfIdle(state) {
  if (state.phase !== 'defend') return;
  const actions = defendActions(state);
  if (actions.length === 1) resolveAttack(state);
}

function doActivateTrap(state, action) {
  const defender = state.priority;
  const player = state.players[defender];
  const trap = removeFrom(player.traps, action.uid);
  if (!trap) throw new Error('伏せカードがない');
  const card = cardOf(trap);
  logMsg(state, `${player.name} は罠「${card.name}」を発動した！`, 'trap');
  state.lastEvent = { type: 'trap', player: defender, cardId: card.id };

  const result = resolveEffect(state, card.effect, {
    controller: defender,
    attackerUid: state.pending.attackerUid,
    attackerOwner: state.pending.attackerOwner,
  });
  player.grave.push(trap);

  if (result.negated) {
    endAttack(state);
    return;
  }
  // 攻撃クリーチャーが効果で場を離れていたら攻撃は不成立
  const attackerStillThere = state.players[state.pending.attackerOwner]
    .field.some((i) => i.uid === state.pending.attackerUid);
  if (!attackerStillThere) {
    endAttack(state);
    return;
  }
  autoResolveDefendIfIdle(state);
}

function doBlock(state, action) {
  const defender = state.priority;
  const blocker = state.players[defender].field.find((i) => i.uid === action.uid);
  if (!blocker) throw new Error('ブロッカーがいない');
  blocker.tapped = true;
  logMsg(state, `${state.players[defender].name} は「${cardOf(blocker).name}」でブロックした！`, 'block');
  state.lastEvent = { type: 'block', player: defender, uid: blocker.uid };

  battle(state, state.pending.attackerOwner, state.pending.attackerUid, defender, blocker.uid, true);
  endAttack(state);
}

/** 防御側が何もしなかった場合の攻撃解決 */
function resolveAttack(state) {
  const { attackerOwner, attackerUid, target } = state.pending;
  const defender = opponentOf(attackerOwner);

  if (target.kind === 'creature') {
    const stillThere = state.players[defender].field.some((i) => i.uid === target.uid);
    if (stillThere) battle(state, attackerOwner, attackerUid, defender, target.uid);
    else logMsg(state, '攻撃対象がいなくなったため、攻撃は不発に終わった。');
    endAttack(state);
    return;
  }

  // プレイヤーへの攻撃
  const defenderPlayer = state.players[defender];
  if (defenderPlayer.shields.length === 0) {
    declareWinner(state, attackerOwner, 'direct');
    return;
  }

  const attacker = state.players[attackerOwner].field.find((i) => i.uid === attackerUid);
  const count = attacker && hasKeyword(cardOf(attacker), 'doubleBreaker') ? 2 : 1;
  breakShields(state, defender, count);
}

function breakShields(state, defender, count) {
  const player = state.players[defender];
  const broken = [];
  for (let i = 0; i < count && player.shields.length > 0; i++) {
    broken.push(player.shields.splice(0, 1)[0]);
  }
  logMsg(state, `${player.name} のシールドが${broken.length}枚ブレイクされた！`, 'break');
  state.lastEvent = { type: 'shieldBreak', player: defender, count: broken.length };

  const triggerQueue = [];
  for (const inst of broken) {
    resetInstance(inst);
    player.hand.push(inst);
    if (hasKeyword(cardOf(inst), 'trigger')) triggerQueue.push(inst.uid);
  }

  if (triggerQueue.length > 0) {
    state.pending = { kind: 'triggers', owner: defender, queue: triggerQueue };
    state.phase = 'trigger';
    state.priority = defender;
    logMsg(state, `${player.name} のシールドトリガーが発動可能！`, 'trigger');
    return;
  }
  endAttack(state);
}

function doUseTrigger(state, action) {
  const owner = state.priority;
  const player = state.players[owner];
  const inst = removeFrom(player.hand, action.uid);
  if (!inst) throw new Error('トリガーカードが手札にない');
  const card = cardOf(inst);
  logMsg(state, `${player.name} はシールドトリガー「${card.name}」を発動した！`, 'trigger');
  state.lastEvent = { type: 'trigger', player: owner, cardId: card.id };

  resolveEffect(state, card.effect, { controller: owner, targetUid: action.targetUid });
  player.grave.push(inst);

  advanceTriggerQueue(state);
}

function doSkipTrigger(state) {
  advanceTriggerQueue(state);
}

function advanceTriggerQueue(state) {
  if (state.phase === 'gameover') return;
  state.pending.queue.shift();
  if (state.pending.queue.length === 0) endAttack(state);
}

function endAttack(state) {
  if (state.phase === 'gameover') return;
  state.pending = null;
  state.phase = 'main';
  state.priority = state.active;
  checkGameOver(state);
}

/* ------------------------------- 戦闘 ------------------------------- */

function battle(state, attackerOwner, attackerUid, defenderOwner, defenderUid, blocking = false) {
  const attacker = state.players[attackerOwner].field.find((i) => i.uid === attackerUid);
  const defender = state.players[defenderOwner].field.find((i) => i.uid === defenderUid);
  if (!attacker || !defender) return;

  const ap = currentPower(attacker);
  const dp = blocking ? blockValue(defender) : defenseValue(defender);
  const attackerSlayer = hasKeyword(cardOf(attacker), 'slayer');
  const defenderSlayer = hasKeyword(cardOf(defender), 'slayer');

  let killAttacker = false;
  let killDefender = false;
  if (ap > dp) killDefender = true;
  else if (ap < dp) killAttacker = true;
  else { killAttacker = true; killDefender = true; } // 同値なら相打ち

  if (attackerSlayer) killDefender = true;
  if (defenderSlayer) killAttacker = true;

  logMsg(
    state,
    `バトル: 「${cardOf(attacker).name}」(${ap}) vs 「${cardOf(defender).name}」(${dp})`,
    'battle',
  );
  state.lastEvent = { type: 'battle', attacker: attackerUid, defender: defenderUid };

  if (killDefender) destroyCreature(state, defenderOwner, defenderUid);
  if (killAttacker) destroyCreature(state, attackerOwner, attackerUid);
}

/* ------------------------------ ターン ------------------------------ */

function endTurn(state) {
  // このターン限りの効果をリセット
  for (const player of state.players) {
    for (const inst of player.field) {
      inst.powerBuff = 0;
      inst.posChangedThisTurn = false;
    }
  }
  sweepZeroPower(state);
  if (state.phase === 'gameover') return;

  logMsg(state, `--- ${state.players[state.active].name} のターン終了 ---`, 'turn');

  state.active = opponentOf(state.active);
  state.turn += 1;
  state.priority = state.active;
  state.phase = 'main';
  state.pending = null;

  if (state.turn > MAX_TURNS) {
    state.phase = 'gameover';
    state.winner = null;
    state.winReason = 'timeout';
    logMsg(state, '規定ターンを超えたため引き分け。', 'win');
    return;
  }

  const player = state.players[state.active];
  for (const inst of player.field) inst.tapped = false;
  for (const inst of player.mana) inst.tapped = false;
  player.chargedThisTurn = false;

  logMsg(state, `--- ターン${state.turn}: ${player.name} のターン ---`, 'turn');
  state.lastEvent = { type: 'turnStart', player: state.active };
  drawCards(state, state.active, 1);
  checkGameOver(state);
}

function checkGameOver(state) {
  if (state.winner !== null) state.phase = 'gameover';
}

/* ================================================================== *
 * 表示用ヘルパー
 * ================================================================== */

/** 行動を日本語の短い説明にする（ログ・CPUの思考表示用） */
export function describeAction(state, action) {
  const nameOf = (uid) => {
    const found = findInstance(state, uid);
    return found ? cardOf(found.inst).name : '?';
  };
  switch (action.type) {
    case 'charge': return `「${nameOf(action.uid)}」をマナに置く`;
    case 'play': {
      const card = cardOf(findInstance(state, action.uid).inst);
      if (card.type === 'creature') {
        return `「${card.name}」を${action.position === 'defense' ? '守備' : '攻撃'}表示で召喚`;
      }
      if (card.type === 'trap') return `「${card.name}」を伏せる`;
      return `「${card.name}」を唱える`;
    }
    case 'changePosition': return `「${nameOf(action.uid)}」の表示形式を変更`;
    case 'attack': return action.target.kind === 'player'
      ? `「${nameOf(action.uid)}」でシールドを攻撃`
      : `「${nameOf(action.uid)}」で「${nameOf(action.target.uid)}」を攻撃`;
    case 'endTurn': return 'ターンを終了';
    case 'activateTrap': return `罠「${nameOf(action.uid)}」を発動`;
    case 'block': return `「${nameOf(action.uid)}」でブロック`;
    case 'pass': return '何もしない';
    case 'useTrigger': return `シールドトリガー「${nameOf(action.uid)}」を使う`;
    case 'skipTrigger': return 'シールドトリガーを使わない';
    default: return action.type;
  }
}
