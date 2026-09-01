/**
 * デュエル画面のコントローラ。
 *
 * ルールには一切触れず、engine/rules.js の legalActions()/applyAction() だけを使う。
 * そのため「CPU対戦」と「2人対戦」の差は、手番のプレイヤーが cpu かどうかで
 * 自動で指し手を進めるかどうか、という1点だけになっている。
 */

import { CIVS, getCard } from '../data/cards.js';
import { cardOf, createGame, findInstance, isSummoningSick, opponentOf } from '../engine/state.js';
import { applyAction, legalActions } from '../engine/rules.js';
import { chooseAction } from '../ai/cpu.js';
import { attachPeek, backEl, cardEl, el, hidePeek } from './cardview.js';

const CPU_DELAY = 620;
const CPU_DELAY_FAST = 260;

const dom = {};
let game = null;

function $(id) {
  if (!dom[id]) dom[id] = document.getElementById(id);
  return dom[id];
}

/* ================================================================== *
 * 開始
 * ================================================================== */

/**
 * @param {object} config
 * @param {{name,cards,controller}[]} config.players
 * @param {'cpu'|'hotseat'} config.mode
 * @param {'easy'|'normal'} config.difficulty
 * @param {number|undefined} config.firstPlayer
 * @param {Function} config.onExit タイトルへ戻るときに呼ぶ
 */
export function startDuel(config) {
  game = {
    config,
    state: createGame({
      players: config.players,
      firstPlayer: config.firstPlayer,
    }),
    selection: null,
    targeting: null,
    busy: false,
    lastActive: null,
    timer: null,
    logOpen: false,
  };
  $('result').hidden = true;
  $('handoff').hidden = true;
  $('logpanel').hidden = true;
  bindOnce();
  // 先攻がCPUなら、そのまま思考を始める
  game.lastActive = game.state.active;
  render();
  scheduleAuto();
}

export function stopDuel() {
  if (game?.timer) clearTimeout(game.timer);
  game = null;
}

let bound = false;
function bindOnce() {
  if (bound) return;
  bound = true;

  $('btn-toggle-log').addEventListener('click', () => {
    $('logpanel').hidden = !$('logpanel').hidden;
    if (!$('logpanel').hidden) renderLog();
  });
  $('btn-close-log').addEventListener('click', () => { $('logpanel').hidden = true; });

  $('btn-quit').addEventListener('click', () => {
    if (!game) return;
    if (!window.confirm('投了してタイトルに戻りますか？')) return;
    leaveDuel();
  });

  $('btn-handoff').addEventListener('click', () => {
    $('handoff').hidden = true;
    render();
    scheduleAuto();
  });

  $('btn-rematch').addEventListener('click', () => {
    const { config } = game;
    stopDuel();
    startDuel(config);
  });
}

function leaveDuel() {
  const onExit = game?.config?.onExit;
  stopDuel();
  if (onExit) onExit();
  else document.dispatchEvent(new CustomEvent('sbd:goto', { detail: 'title' }));
}

/* ================================================================== *
 * 視点とプレイヤー
 * ================================================================== */

/** 画面下側に表示するプレイヤー */
function viewpoint() {
  const { state, config } = game;
  if (config.mode === 'cpu') {
    return state.players.findIndex((p) => p.controller === 'human');
  }
  return state.active;
}

function isHumanTurn() {
  const { state } = game;
  return state.phase !== 'gameover'
    && state.players[state.priority].controller === 'human';
}

/** 割り込み中（防御・トリガー）で、手番プレイヤーとは別の人が操作する状況か */
function isInterrupt() {
  const { state } = game;
  return state.phase === 'defend' || state.phase === 'trigger';
}

/* ================================================================== *
 * 描画
 * ================================================================== */

function render() {
  if (!game) return;
  const { state } = game;
  const me = viewpoint();
  const foe = opponentOf(me);

  renderInfo($('me-info'), me, state.active === me);
  renderInfo($('foe-info'), foe, state.active === foe);

  renderShields($('me-shields'), me);
  renderShields($('foe-shields'), foe);
  renderField($('me-field'), me);
  renderField($('foe-field'), foe);
  renderMana($('me-mana'), me);
  renderMana($('foe-mana'), foe);
  renderTraps($('me-traps'), me, true);
  renderTraps($('foe-traps'), foe, false);
  renderHand($('me-hand'), me);

  renderStatus();
  renderActionBar();
  applyTargetHighlights();
  if (!$('logpanel').hidden) renderLog();
}

function renderInfo(node, index, isTurn) {
  const player = game.state.players[index];
  node.className = `side__info${isTurn ? ' is-turn' : ''}`;
  node.replaceChildren();
  node.append(el('span', 'side__name', player.name));
  const untapped = player.mana.filter((m) => !m.tapped).length;
  const pills = [
    ['🛡 シールド', player.shields.length],
    ['🃏 手札', player.hand.length],
    ['💠 マナ', `${untapped}/${player.mana.length}`],
    ['📚 山札', player.deck.length],
    ['⚰️ 墓地', player.grave.length],
  ];
  for (const [label, value] of pills) {
    const pill = el('span', 'pill');
    pill.append(document.createTextNode(`${label} `), el('b', null, String(value)));
    node.append(pill);
  }
}

function renderShields(node, index) {
  const player = game.state.players[index];
  node.replaceChildren();
  node.dataset.zone = 'shields';
  node.dataset.player = String(index);
  if (player.shields.length === 0) {
    node.append(el('span', 'zone__empty', 'シールドなし ― 次の攻撃が通れば敗北'));
    return;
  }
  for (const inst of player.shields) {
    const back = backEl('shield', '🛡');
    back.dataset.uid = inst.uid;
    node.append(back);
  }
}

function renderField(node, index) {
  const { state } = game;
  const player = state.players[index];
  node.replaceChildren();
  if (player.field.length === 0) {
    node.append(el('span', 'zone__empty', 'バトルゾーンは空'));
    return;
  }
  for (const inst of player.field) {
    const card = cardOf(inst);
    const node2 = cardEl(card, { inst });
    node2.dataset.uid = inst.uid;
    if (inst.tapped) node2.classList.add('is-tapped');
    if (inst.position === 'defense') node2.classList.add('is-defense');
    if (index === state.active && isSummoningSick(state, inst)) node2.classList.add('is-sick');
    if (state.pending?.attackerUid === inst.uid) node2.classList.add('fx-flash');
    if (game.selection?.uid === inst.uid) node2.classList.add('is-selected');
    node2.append(el('div', 'card__kind', inst.position === 'defense' ? '守備表示' : '攻撃表示'));
    node.append(node2);
  }
}

function renderMana(node, index) {
  const player = game.state.players[index];
  node.replaceChildren();
  if (player.mana.length === 0) {
    node.append(el('span', 'zone__empty', 'マナゾーンは空'));
    return;
  }
  for (const inst of player.mana) {
    const card = cardOf(inst);
    const chip = el('div', `manachip manachip--${card.civ}${inst.tapped ? ' is-tapped' : ''}`);
    chip.append(el('span', 'manachip__civ', CIVS[card.civ].emoji));
    attachPeek(chip, card);
    node.append(chip);
  }
}

function renderTraps(node, index, own) {
  const player = game.state.players[index];
  node.replaceChildren();
  if (player.traps.length === 0) {
    node.append(el('span', 'zone__empty', '伏せカードなし'));
    return;
  }
  for (const inst of player.traps) {
    if (own) {
      // 自分の伏せカードは中身が分かる
      const card = cardOf(inst);
      const mini = cardEl(card, { mini: true });
      mini.dataset.uid = inst.uid;
      mini.style.opacity = '.85';
      node.append(mini);
    } else {
      node.append(backEl('trap', '⁉️'));
    }
  }
}

function renderHand(node, index) {
  const { state, config } = game;
  node.replaceChildren();
  const player = state.players[index];

  // 2人対戦では、割り込み中に手番でない人の手札を見せない
  const hide = config.mode === 'hotseat' && isInterrupt() && state.priority !== index;
  if (player.controller === 'cpu' || hide) {
    for (let i = 0; i < player.hand.length; i++) node.append(backEl('hand', '🂠'));
    return;
  }

  const actionsByUid = handActionMap();
  for (const inst of player.hand) {
    const card = cardOf(inst);
    const node2 = cardEl(card, { inst });
    node2.dataset.uid = inst.uid;
    if (actionsByUid.has(inst.uid)) node2.classList.add('is-actionable');
    if (game.selection?.uid === inst.uid) node2.classList.add('is-selected');
    node.append(node2);
  }
}

/** 手札のカードごとに、いま選べる行動があるか */
function handActionMap() {
  const map = new Map();
  if (!isHumanTurn() || game.state.phase !== 'main') return map;
  for (const action of legalActions(game.state)) {
    if (action.type !== 'charge' && action.type !== 'play') continue;
    if (!map.has(action.uid)) map.set(action.uid, []);
    map.get(action.uid).push(action);
  }
  return map;
}

function renderStatus() {
  const { state } = game;
  const node = $('duel-status');
  node.replaceChildren();

  if (state.phase === 'gameover') {
    node.append(el('span', null, '決着'));
    return;
  }
  const actor = state.players[state.priority];
  let text = `ターン${state.turn} ／ ${state.players[state.active].name} の番`;
  if (state.phase === 'defend') text += ` ― ${actor.name} は防御を選択中`;
  else if (state.phase === 'trigger') text += ` ― ${actor.name} のシールドトリガー`;
  else if (!state.players[state.active].chargedThisTurn) text += ' ― マナチャージがまだ可能';
  node.append(el('b', null, text));
}

/* ================================================================== *
 * 行動バー
 * ================================================================== */

function renderActionBar() {
  const bar = $('actionbar');
  bar.replaceChildren();
  const { state } = game;
  if (state.phase === 'gameover') return;

  if (!isHumanTurn()) {
    bar.append(el('span', 'actionbar__prompt', `${state.players[state.priority].name} が考えています…`));
    return;
  }

  if (state.phase === 'defend') return renderDefendBar(bar);
  if (state.phase === 'trigger') return renderTriggerBar(bar);
  return renderMainBar(bar);
}

function renderMainBar(bar) {
  const { state, selection, targeting } = game;

  if (targeting) {
    bar.append(el('span', 'actionbar__prompt', targeting.prompt));
    // 盤面に見えない対象（墓地など）はここにカードとして並べる
    for (const entry of targeting.offBoard) {
      const btn = cardEl(entry.card, { mini: true });
      btn.classList.add('is-target');
      btn.addEventListener('click', () => submit(entry.action));
      bar.append(btn);
    }
    const cancel = el('button', 'btn btn--tiny', 'やめる');
    cancel.addEventListener('click', () => { game.targeting = null; render(); });
    bar.append(cancel);
    return;
  }

  if (selection) {
    for (const intent of selection.intents) {
      const btn = el('button', 'btn btn--tiny', intent.label);
      btn.addEventListener('click', () => chooseIntent(intent));
      bar.append(btn);
    }
    const cancel = el('button', 'btn btn--ghost btn--tiny', '選択解除');
    cancel.addEventListener('click', () => { game.selection = null; render(); });
    bar.append(cancel);
  } else {
    bar.append(el('span', 'actionbar__prompt', 'カードをクリックして行動を選びます'));
  }

  const endTurn = legalActions(state).find((a) => a.type === 'endTurn');
  if (endTurn) {
    const btn = el('button', 'btn btn--primary btn--tiny', 'ターン終了');
    btn.addEventListener('click', () => submit(endTurn));
    bar.append(btn);
  }
}

function renderDefendBar(bar) {
  const { state } = game;
  const actions = legalActions(state);
  const attacker = findInstance(state, state.pending.attackerUid);
  const attackerName = attacker ? cardOf(attacker.inst).name : '?';
  const targetText = state.pending.target.kind === 'player'
    ? 'シールド'
    : `「${cardOf(findInstance(state, state.pending.target.uid).inst).name}」`;

  bar.append(el('span', 'actionbar__prompt',
    `「${attackerName}」が ${targetText} を攻撃！ 応じますか？`));

  for (const action of actions) {
    if (action.type === 'activateTrap') {
      const card = cardOf(findInstance(state, action.uid).inst);
      const btn = el('button', 'btn btn--tiny', `罠：${card.name}`);
      btn.title = card.text;
      btn.addEventListener('click', () => submit(action));
      bar.append(btn);
    } else if (action.type === 'block') {
      const inst = findInstance(state, action.uid).inst;
      const card = cardOf(inst);
      const btn = el('button', 'btn btn--tiny',
        `🛡 ${card.name} でブロック（ガード${card.guard + inst.powerBuff}）`);
      btn.addEventListener('click', () => submit(action));
      bar.append(btn);
    }
  }
  const pass = actions.find((a) => a.type === 'pass');
  if (pass) {
    const btn = el('button', 'btn btn--primary btn--tiny', '攻撃を通す');
    btn.addEventListener('click', () => submit(pass));
    bar.append(btn);
  }
}

function renderTriggerBar(bar) {
  const { state, targeting } = game;
  const uid = state.pending.queue[0];
  const found = findInstance(state, uid);
  const card = found ? cardOf(found.inst) : null;

  if (card) {
    bar.append(el('span', 'actionbar__prompt', 'シールドトリガー発動！'));
    const preview = cardEl(card, { mini: true });
    bar.append(preview);
  }

  if (targeting) {
    bar.append(el('span', 'actionbar__prompt', targeting.prompt));
    for (const entry of targeting.offBoard) {
      const btn = cardEl(entry.card, { mini: true });
      btn.classList.add('is-target');
      btn.addEventListener('click', () => submit(entry.action));
      bar.append(btn);
    }
    const cancel = el('button', 'btn btn--tiny', 'やめる');
    cancel.addEventListener('click', () => { game.targeting = null; render(); });
    bar.append(cancel);
    return;
  }

  const actions = legalActions(state);
  const uses = actions.filter((a) => a.type === 'useTrigger');
  if (uses.length > 0) {
    const btn = el('button', 'btn btn--primary btn--tiny', '使う');
    btn.addEventListener('click', () => {
      if (uses.length === 1 && !uses[0].targetUid) return submit(uses[0]);
      beginTargeting(uses, '対象を選んでください');
    });
    bar.append(btn);
  } else if (card) {
    // 対象がいないなど、条件を満たさず発動できない場合は理由を示す
    bar.append(el('span', 'actionbar__note', '― 効果の対象がいないため、このトリガーは使えません'));
  }

  const skip = actions.find((a) => a.type === 'skipTrigger');
  if (skip) {
    const label = uses.length > 0 ? '使わない（手札に残す）' : '手札に加えて続ける';
    const btn = el('button', `btn btn--tiny${uses.length > 0 ? '' : ' btn--primary'}`, label);
    btn.addEventListener('click', () => submit(skip));
    bar.append(btn);
  }
}

/* ================================================================== *
 * 選択と対象指定
 * ================================================================== */

const INTENT_LABEL = {
  charge: '💠 マナに置く',
  'play:attack': '⚔️ 攻撃表示で召喚',
  'play:defense': '🛡 守備表示で召喚',
  'play:spell': '✨ 唱える',
  'play:trap': '⁉️ 伏せる',
  changePosition: '🔄 表示形式を変える',
  attack: '⚔️ 攻撃する',
};

/** 選択したカードについて、行動の種類ごとにまとめる */
function buildIntents(uid) {
  const { state } = game;
  const actions = legalActions(state).filter((a) => a.uid === uid);
  const groups = new Map();

  for (const action of actions) {
    let key = action.type;
    if (action.type === 'play') {
      const card = cardOf(findInstance(state, uid).inst);
      if (card.type === 'creature') key = `play:${action.position}`;
      else key = `play:${card.type}`;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(action);
  }

  return [...groups.entries()].map(([key, list]) => ({
    key,
    label: INTENT_LABEL[key] || key,
    actions: list,
  }));
}

function selectCard(uid) {
  if (!isHumanTurn() || game.state.phase !== 'main') return;
  if (game.selection?.uid === uid) {
    game.selection = null;
    game.targeting = null;
    render();
    return;
  }
  const intents = buildIntents(uid);
  if (intents.length === 0) return;
  game.targeting = null;
  game.selection = { uid, intents };

  // 攻撃だけしかできないなら、すぐに対象選択へ進める
  if (intents.length === 1 && intents[0].key === 'attack') {
    chooseIntent(intents[0]);
    return;
  }
  render();
}

function chooseIntent(intent) {
  // 選択肢が1つで、しかも対象を取らないならそのまま実行する
  const onlyAction = intent.actions.length === 1 ? intent.actions[0] : null;
  if (onlyAction && intent.key !== 'attack' && !onlyAction.targetUid) {
    return submit(onlyAction);
  }
  const prompt = intent.key === 'attack'
    ? '攻撃する相手を選んでください（相手のシールド、またはタップ中／守備表示のクリーチャー）'
    : '効果の対象を選んでください';
  beginTargeting(intent.actions, prompt);
}

/**
 * 対象選択モードに入る。
 * 盤面に見えている対象はハイライトし、墓地など見えない対象は行動バーに並べる。
 */
function beginTargeting(actions, prompt) {
  const { state } = game;
  const onBoard = new Map(); // key -> action
  const offBoard = [];
  let playerZone = null;

  for (const action of actions) {
    if (action.type === 'attack') {
      if (action.target.kind === 'player') playerZone = action;
      else onBoard.set(action.target.uid, action);
      continue;
    }
    const uid = action.targetUid;
    if (!uid) continue;
    const found = findInstance(state, uid);
    if (found && found.zone === 'field') onBoard.set(uid, action);
    else if (found) offBoard.push({ action, card: cardOf(found.inst) });
  }

  game.targeting = { onBoard, offBoard, playerZone, prompt };
  render();
}

/** 対象選択中のハイライトとクリック処理を盤面に反映する */
function applyTargetHighlights() {
  const foeShields = $('foe-shields');
  const meShields = $('me-shields');
  // onclick は代入なので、対象選択を抜けたときに古いハンドラが残らない
  for (const zone of [foeShields, meShields]) {
    zone.classList.remove('is-targetzone');
    zone.onclick = null;
  }

  if (!game.targeting) return;
  const { onBoard, playerZone } = game.targeting;

  for (const [uid, action] of onBoard) {
    const node = document.querySelector(`#screen-duel .card[data-uid="${uid}"]`);
    if (!node) continue;
    node.classList.add('is-target');
    node.onclick = (event) => {
      event.stopPropagation();
      submit(action);
    };
  }

  if (playerZone) {
    const defenderIndex = opponentOf(game.state.active);
    const zone = defenderIndex === viewpoint() ? meShields : foeShields;
    zone.classList.add('is-targetzone');
    zone.onclick = () => submit(playerZone);
  }
}

/* ================================================================== *
 * 行動の実行
 * ================================================================== */

function submit(action) {
  if (!game || game.busy) return;
  hidePeek();
  game.selection = null;
  game.targeting = null;

  const before = game.state;
  game.state = applyAction(before, action);
  playEffects(before, game.state);
  render();
  scheduleAuto();
}

/** CPU の手番、手番の受け渡し、決着を進める */
function scheduleAuto() {
  if (!game) return;
  const { state, config } = game;

  if (state.phase === 'gameover') {
    game.timer = setTimeout(showResult, 700);
    return;
  }

  // 2人対戦：ターンが変わったら画面の受け渡しを挟む
  if (config.mode === 'hotseat' && state.active !== game.lastActive) {
    game.lastActive = state.active;
    $('handoff-name').textContent = `${state.players[state.active].name} のターン`;
    $('handoff').hidden = false;
    return;
  }
  game.lastActive = state.active;

  if (state.players[state.priority].controller !== 'cpu') return;

  game.busy = true;
  const action = chooseAction(state, config.difficulty || 'normal');
  const delay = action && (action.type === 'charge' || action.type === 'endTurn')
    ? CPU_DELAY_FAST : CPU_DELAY;
  game.timer = setTimeout(() => {
    if (!game) return;
    game.busy = false;
    if (!action) return;
    const before = game.state;
    game.state = applyAction(before, action);
    playEffects(before, game.state);
    render();
    scheduleAuto();
  }, delay);
}

/* ================================================================== *
 * 演出
 * ================================================================== */

let toastTimer = null;
function toast(text) {
  const node = el('div', 'toast', text);
  document.body.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 1500);
  setTimeout(() => node.remove(), 1600);
}

function playEffects(before, after) {
  const event = after.lastEvent;
  if (!event) return;

  if (event.type === 'shieldBreak') {
    const zone = event.player === viewpoint() ? $('me-shields') : $('foe-shields');
    zone.querySelectorAll('.cardback').forEach((node, i) => {
      if (i < event.count) node.classList.add('fx-break');
    });
    toast(`シールドブレイク！ ×${event.count}`);
    $('screen-duel').classList.add('fx-shake');
    setTimeout(() => $('screen-duel').classList.remove('fx-shake'), 400);
  } else if (event.type === 'trigger') {
    toast(`シールドトリガー：${getCard(event.cardId).name}`);
  } else if (event.type === 'trap') {
    toast(`罠発動：${getCard(event.cardId).name}`);
  } else if (event.type === 'spell') {
    toast(`呪文：${getCard(event.cardId).name}`);
  }

  const destroyed = after.log.slice(before.log.length).filter((l) => l.kind === 'destroy');
  if (destroyed.length > 0 && event.type !== 'shieldBreak') toast('クリーチャー破壊！');
}

function renderLog() {
  const list = $('loglist');
  list.replaceChildren();
  for (const entry of game.state.log.slice(-120)) {
    list.append(el('li', `k-${entry.kind}`, entry.text));
  }
  list.scrollTop = list.scrollHeight;
}

function showResult() {
  const { state } = game;
  const human = state.players.findIndex((p) => p.controller === 'human');
  const box = $('result');
  const title = $('result-title');
  const detail = $('result-detail');

  if (state.winner === null) {
    title.textContent = '引き分け';
    detail.textContent = '規定ターンを超えたため引き分けになりました。';
  } else {
    const winner = state.players[state.winner];
    const won = game.config.mode === 'cpu' ? state.winner === human : true;
    title.textContent = game.config.mode === 'cpu'
      ? (won ? '🏆 勝利！' : '💀 敗北…')
      : `🏆 ${winner.name} の勝利！`;
    detail.textContent = state.winReason === 'deckout'
      ? `${state.players[opponentOf(state.winner)].name} の山札が尽きました。`
      : `${winner.name} のダイレクトアタックが決まりました（${state.turn}ターン）。`;
  }
  box.hidden = false;
}

/* ================================================================== *
 * 盤面のクリック
 * ================================================================== */

document.addEventListener('click', (event) => {
  if (!game) return;
  if ($('screen-duel').classList.contains('is-active') === false) return;

  // 行動バーのボタンなどは、自分の click ハンドラの中で render() を呼び、
  // その時点で DOM から取り除かれる。ここまでバブリングしてきた時点では
  // すでに document から切り離されているため closest() が効かない。
  // 「切り離された要素からのイベント＝すでに処理済み」とみなして無視する。
  if (!event.target.isConnected) return;

  const cardNode = event.target.closest('#me-hand .card, #me-field .card, #screen-duel .zone--field .card');
  if (!cardNode || !cardNode.dataset.uid) {
    if (event.target.closest('#actionbar') || event.target.closest('.overlay')) return;
    if (game.selection || game.targeting) {
      game.selection = null;
      game.targeting = null;
      render();
    }
    return;
  }
  if (cardNode.classList.contains('is-target')) return; // 対象選択のハンドラに任せる

  const found = findInstance(game.state, cardNode.dataset.uid);
  if (!found) return;
  // 自分のカードだけ選択できる
  if (found.player !== game.state.active) return;
  selectCard(cardNode.dataset.uid);
});
