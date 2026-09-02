/**
 * デュエル画面のコントローラ。
 *
 * ルールには一切触れず、engine/rules.js の legalActions()/applyAction() だけを使う。
 * そのため「CPU対戦」と「2人対戦」の差は、手番のプレイヤーが cpu かどうかで
 * 自動で指し手を進めるかどうか、という1点だけになっている。
 *
 * 画面は「盤面（5段 + 手札）」と「レール（行動 + ログ）」の2つ。
 * 対象の選択は、メイン・防御・トリガーのどのフェイズでも
 *   1. 盤面上のカードを破線で光らせて押せるようにする
 *   2. 同じ選択肢をレールにボタンとして並べる（数字キーで選べる）
 * の両方を用意する。
 */

import { getCard } from '../data/cards.js';
import { cardOf, createGame, findInstance, isSummoningSick, opponentOf } from '../engine/state.js';
import { applyAction, legalActions } from '../engine/rules.js';
import { chooseAction } from '../ai/cpu.js';
import { attachPeek, backEl, cardEl, el, hidePeek } from './cardview.js';
import { clearGame, loadPrefs, saveGame, savePrefs } from './storage.js';

const CPU_DELAY = 620;
const CPU_DELAY_FAST = 260;

const dom = {};
let game = null;
/** 直近の操作がキーボードか。マウス操作のときはフォーカスを戻さない（枠が邪魔になる） */
let keyboardUser = false;
document.addEventListener('keydown', () => { keyboardUser = true; }, true);
document.addEventListener('pointerdown', () => { keyboardUser = false; }, true);

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
 * @param {{state:object, lastActive:number}} [config.resume] 保存された対戦を再開するとき
 */
export function startDuel(config) {
  const { resume, ...rest } = config;
  game = {
    config: rest,
    state: resume ? resume.state : createGame({
      players: config.players,
      firstPlayer: config.firstPlayer,
    }),
    selection: null,
    targeting: null,
    busy: false,
    lastActive: null,
    timer: null,
    announced: 0,
    coachDone: !!loadPrefs().coachDone,
  };
  $('result').hidden = true;
  $('handoff').hidden = true;
  setLogOpen(false);
  bindOnce();
  // 再開時は、2人対戦なら必ず受け渡し画面を挟む（前の人の手札を見せない）
  game.lastActive = resume && rest.mode === 'hotseat' ? -1 : game.state.active;
  game.announced = game.state.log.length;
  render();
  scheduleAuto();
}

export function stopDuel() {
  if (game?.timer) clearTimeout(game.timer);
  game = null;
}

/** 対戦画面が動いているか（ルーティングが使う） */
export function isDuelActive() {
  return !!game;
}

/** 進行中の対戦を保存する。決着していれば消す */
function persist() {
  if (!game) return;
  if (game.state.phase === 'gameover') {
    clearGame();
    return;
  }
  const { mode, difficulty, firstPlayer, players } = game.config;
  saveGame({
    config: { mode, difficulty, firstPlayer, players },
    state: game.state,
    lastActive: game.lastActive,
    savedAt: Date.now(),
  });
}

/** スクリーンリーダー向けに、盤面で起きたことを読み上げる */
function announce() {
  const live = $('sr-live');
  if (!live || !game) return;
  const fresh = game.state.log.slice(game.announced);
  game.announced = game.state.log.length;
  if (fresh.length === 0) return;
  // 同じ文言でも読み上げ直せるよう、いったん空にする
  live.textContent = '';
  live.textContent = fresh.map((entry) => entry.text).join(' ');
}

let bound = false;
function bindOnce() {
  if (bound) return;
  bound = true;

  $('btn-toggle-log').addEventListener('click', () => {
    setLogOpen(!$('rail').classList.contains('is-logopen'));
  });
  $('btn-close-log').addEventListener('click', () => setLogOpen(false));

  $('btn-quit').addEventListener('click', () => {
    if (!game) return;
    if (!window.confirm('投了してタイトルに戻りますか？')) return;
    clearGame();
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

  document.addEventListener('keydown', onKeyDown);
}

/** 狭い画面ではログを折りたたむ。広い画面では CSS が常時表示にする */
function setLogOpen(open) {
  $('rail').classList.toggle('is-logopen', open);
  $('btn-toggle-log').setAttribute('aria-expanded', String(open));
  if (open) renderLog();
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

  // 描画で DOM を作り直すので、キーボード操作中はフォーカスしていたカードを覚えておいて戻す
  const focused = keyboardUser
    ? document.activeElement?.closest?.('#screen-duel [data-uid]')?.dataset.uid
    : null;

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
  renderLog();
  announce();
  persist();

  if (focused) {
    const again = document.querySelector(`#screen-duel [data-uid="${focused}"]`);
    if (again) again.focus({ preventScroll: true });
  }
}

function renderInfo(node, index, isTurn) {
  const player = game.state.players[index];
  const side = node.id === 'me-info' ? 'me' : 'foe';
  node.className = `ledger ledger--${side}${isTurn ? ' is-turn' : ''}`;
  node.setAttribute('aria-label', `${player.name}の状況`);
  $(`${side}-name`).textContent = player.name;
  $(`${side}-hand-count`).textContent = String(player.hand.length);
  const untapped = player.mana.filter((m) => !m.tapped).length;
  $(`${side}-mana-count`).textContent = `${untapped}/${player.mana.length}`;
  $(`${side}-deck-count`).textContent = String(player.deck.length);
  $(`${side}-grave-count`).textContent = String(player.grave.length);
}

function renderShields(node, index) {
  const player = game.state.players[index];
  node.replaceChildren();
  node.dataset.player = String(index);
  node.setAttribute('aria-label', `シールド ${player.shields.length}枚`);
  if (player.shields.length === 0) {
    node.append(el('span', 'zone__empty', '0 ― 次の攻撃で敗北'));
    return;
  }
  for (const inst of player.shields) {
    const back = backEl('shield');
    back.dataset.uid = inst.uid;
    node.append(back);
  }
}

function renderField(node, index) {
  const { state } = game;
  const player = state.players[index];
  node.replaceChildren();
  if (player.field.length === 0) {
    const own = index === viewpoint();
    node.append(el('span', 'zone__empty',
      own && !game.coachDone ? 'バトルゾーンは空。召喚したクリーチャーがここに並ぶ' : 'バトルゾーンは空'));
    return;
  }
  for (const inst of player.field) {
    const card = cardOf(inst);
    const node2 = cardEl(card, { inst });
    node2.dataset.uid = inst.uid;
    const notes = [];
    const defense = inst.position === 'defense';
    node2.append(el('span', 'card__pos', defense ? '守備表示' : '攻撃表示'));
    notes.push(defense ? '守備表示' : '攻撃表示');
    if (inst.tapped) { node2.classList.add('is-tapped'); notes.push('タップ済み'); }
    if (defense) node2.classList.add('is-defense');
    if (!inst.tapped && index === state.active && isSummoningSick(state, inst)) {
      node2.classList.add('is-sick');
      node2.append(el('span', 'card__state', '召喚酔い'));
      notes.push('召喚酔い');
    }
    if (state.pending?.attackerUid === inst.uid) node2.classList.add('fx-flash');
    if (game.selection?.uid === inst.uid) {
      node2.classList.add('is-selected');
      node2.setAttribute('aria-pressed', 'true');
    }
    node2.setAttribute('aria-label', `${node2.getAttribute('aria-label')}、${notes.join('、')}`);
    node.append(node2);
  }
}

function renderMana(node, index) {
  const player = game.state.players[index];
  node.replaceChildren();
  if (player.mana.length === 0) {
    node.append(el('span', 'zone__empty', '―'));
    return;
  }
  for (const inst of player.mana) {
    const card = cardOf(inst);
    const chip = el('span', `manachip manachip--${card.civ}${inst.tapped ? ' is-tapped' : ''}`);
    chip.title = `${card.name}${inst.tapped ? '（使用済み）' : ''}`;
    attachPeek(chip, card);
    node.append(chip);
  }
}

function renderTraps(node, index, own) {
  const player = game.state.players[index];
  node.replaceChildren();
  if (player.traps.length === 0) {
    node.append(el('span', 'zone__empty', '―'));
    return;
  }
  for (const inst of player.traps) {
    if (own) {
      // 自分の伏せカードは中身が分かる
      const card = cardOf(inst);
      const mini = cardEl(card, { mini: true });
      mini.dataset.uid = inst.uid;
      mini.setAttribute('aria-label', `伏せカード：${card.name}`);
      node.append(mini);
    } else {
      node.append(backEl('trap'));
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
    for (let i = 0; i < player.hand.length; i++) node.append(backEl('hand'));
    if (player.hand.length === 0) node.append(el('span', 'zone__empty', '手札なし'));
    return;
  }
  if (player.hand.length === 0) {
    node.append(el('span', 'zone__empty', '手札なし'));
    return;
  }

  const actionsByUid = handActionMap();
  for (const inst of player.hand) {
    const card = cardOf(inst);
    const node2 = cardEl(card, { inst });
    node2.dataset.uid = inst.uid;
    if (actionsByUid.has(inst.uid)) {
      node2.classList.add('is-actionable');
      node2.setAttribute('aria-label', `${node2.getAttribute('aria-label')}、いま使える`);
    }
    if (game.selection?.uid === inst.uid) {
      node2.classList.add('is-selected');
      node2.setAttribute('aria-pressed', 'true');
    }
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

  const turn = el('span', 'center__turn');
  turn.append(document.createTextNode('ターン '), el('b', null, String(state.turn)));
  node.append(turn);

  if (state.phase === 'gameover') {
    node.append(el('span', 'center__who', '決着'));
    return;
  }

  const active = state.players[state.active];
  node.append(el('span', 'center__who', `${active.name} の番`));

  const phase = { main: 'メイン', defend: '防御', trigger: 'トリガー' }[state.phase] || state.phase;
  node.append(el('span', 'center__chip is-on', phase));

  if (state.phase === 'main') {
    const charged = active.chargedThisTurn;
    const chip = el('span', `center__chip${charged ? '' : ' is-alert'}`, charged ? 'マナチャージ 済' : 'マナチャージ 未');
    node.append(chip);
  } else {
    const actor = state.players[state.priority];
    node.append(el('span', 'center__note',
      state.phase === 'defend' ? `${actor.name} が応じ方を選択中` : `${actor.name} のシールドトリガー`));
  }
}

/* ================================================================== *
 * 行動パネル
 * ================================================================== */

/** 数字キーで押せるボタン。順番に 1, 2, 3… を割り当てる */
function hotkeyButton(bar, label, onClick, opts = {}) {
  const btn = el('button', `btn${opts.primary ? ' btn--primary' : ''}${opts.ghost ? ' btn--ghost' : ''}`);
  btn.type = 'button';
  btn.append(document.createTextNode(label));
  const key = opts.key ?? nextHotkey(bar);
  if (key) {
    btn.dataset.hotkey = key;
    btn.append(el('kbd', null, key));
  }
  btn.addEventListener('click', onClick);
  bar.append(btn);
  return btn;
}

function nextHotkey(bar) {
  const used = bar.querySelectorAll('[data-hotkey]').length;
  return used < 9 ? String(used + 1) : null;
}

/** ミニカード付きのボタン。同名カードが並んでも、絵柄と数値で区別できる */
function cardButton(bar, card, text, sub, onClick, opts = {}) {
  const btn = el('button', `btn btn--withcard${opts.primary ? ' btn--primary' : ''}`);
  btn.type = 'button';
  const mini = cardEl(card, { mini: true });
  mini.tabIndex = -1;
  mini.setAttribute('aria-hidden', 'true');
  const label = el('span', 'btn__text');
  label.append(document.createTextNode(text));
  if (sub) label.append(el('small', null, sub));
  btn.append(mini, label);
  const key = opts.key ?? nextHotkey(bar);
  if (key) {
    btn.dataset.hotkey = key;
    btn.append(el('kbd', null, key));
  }
  btn.addEventListener('click', onClick);
  bar.append(btn);
  return btn;
}

function renderActionBar() {
  const bar = $('actionbar');
  bar.replaceChildren();
  const { state } = game;
  if (state.phase === 'gameover') {
    bar.append(el('span', 'actionbar__prompt is-wait', '決着しました'));
    return;
  }

  if (!isHumanTurn()) {
    bar.append(el('span', 'actionbar__prompt is-wait', `${state.players[state.priority].name} が考えています…`));
    return;
  }

  if (state.phase === 'defend') return renderDefendBar(bar);
  if (state.phase === 'trigger') return renderTriggerBar(bar);
  if (!game.coachDone) renderCoach(bar);
  return renderMainBar(bar);
}

/** 初回だけ出す、最初の数手の案内。閉じるか1戦終えると二度と出ない */
function renderCoach(bar) {
  const box = el('div', 'coach');
  box.setAttribute('role', 'note');
  const head = el('div', 'coach__head');
  head.append(el('b', null, 'はじめての人へ'));
  const close = el('button', 'btn btn--ghost btn--tiny', '閉じる');
  close.type = 'button';
  close.addEventListener('click', () => {
    game.coachDone = true;
    savePrefs({ coachDone: true });
    render();
  });
  head.append(close);
  box.append(head);
  const steps = el('ol', 'coach__steps');
  for (const text of [
    '手札を押して「マナに置く」。毎ターン1枚ずつマナが増える',
    'マナがコストぶん貯まったら、手札のクリーチャーを召喚する',
    '次のターンから攻撃できる。まずは相手のシールドを狙う',
  ]) steps.append(el('li', null, text));
  box.append(steps);
  bar.append(box);
}

/** 対象選択中の共通部分：案内文、盤面外の対象、盤面上の対象のボタン列、やめる */
function renderTargetingBar(bar) {
  const { state, targeting } = game;
  bar.append(el('span', 'actionbar__prompt', targeting.prompt));

  const group = el('div', 'actionbar__group');
  if (targeting.playerZone) {
    const defender = state.players[opponentOf(state.active)];
    hotkeyButton(group, `${defender.name} のシールドを攻撃`, () => submit(targeting.playerZone));
  }
  for (const [uid, action] of targeting.onBoard) {
    const found = findInstance(state, uid);
    if (!found) continue;
    const card = cardOf(found.inst);
    const inst = found.inst;
    const sub = card.type === 'creature'
      ? `${inst.position === 'defense' ? '守備表示' : '攻撃表示'}${inst.tapped ? '・タップ済み' : ''} ／ 攻${card.power + (inst.powerBuff || 0)} 守${card.guard + (inst.powerBuff || 0)}`
      : null;
    cardButton(group, card, card.name, sub, () => submit(action));
  }
  // 盤面に見えない対象（墓地など）はここにカードとして並べる
  for (const entry of targeting.offBoard) {
    cardButton(group, entry.card, entry.card.name, entry.note || null, () => submit(entry.action));
  }
  bar.append(group);

  hotkeyButton(bar, 'やめる', () => { game.targeting = null; render(); }, { ghost: true, key: 'Esc' });
}

function renderMainBar(bar) {
  const { state, selection, targeting } = game;

  if (targeting) return renderTargetingBar(bar);

  if (selection) {
    const found = findInstance(state, selection.uid);
    const card = found ? cardOf(found.inst) : null;
    bar.append(el('span', 'actionbar__prompt', card ? `「${card.name}」をどうしますか` : '行動を選んでください'));
    const group = el('div', 'actionbar__group');
    for (const intent of selection.intents) {
      hotkeyButton(group, intent.label, () => chooseIntent(intent));
    }
    bar.append(group);
    hotkeyButton(bar, '選択解除', () => { game.selection = null; render(); }, { ghost: true, key: 'Esc' });
  } else {
    const charged = state.players[state.active].chargedThisTurn;
    bar.append(el('span', 'actionbar__prompt is-wait',
      charged ? 'カードを押して行動を選ぶ' : '手札を押して、まずマナに置く'));
  }

  const endTurn = legalActions(state).find((a) => a.type === 'endTurn');
  if (endTurn) {
    bar.append(el('div', 'actionbar__spacer'));
    hotkeyButton(bar, 'ターン終了', () => submit(endTurn), { primary: true, key: 'E' });
  }
}

function renderDefendBar(bar) {
  const { state } = game;
  const actions = legalActions(state);
  const attacker = findInstance(state, state.pending.attackerUid);
  const attackerCard = attacker ? cardOf(attacker.inst) : null;
  const targetText = state.pending.target.kind === 'player'
    ? 'シールド'
    : `「${cardOf(findInstance(state, state.pending.target.uid).inst).name}」`;

  bar.append(el('span', 'actionbar__prompt',
    `「${attackerCard?.name ?? '?'}」（攻${attackerCard ? attackerCard.power + (attacker.inst.powerBuff || 0) : '?'}）が ${targetText} を攻撃。どう応じますか`));

  // ブロッカーは盤面でも押せるようにする（同名でも取り違えない）
  const onBoard = new Map();
  const group = el('div', 'actionbar__group');
  for (const action of actions) {
    if (action.type === 'block') {
      const inst = findInstance(state, action.uid).inst;
      const card = cardOf(inst);
      onBoard.set(action.uid, action);
      cardButton(group, card, `${card.name} でブロック`, `守 ${card.guard + (inst.powerBuff || 0)} で受ける`, () => submit(action));
    }
  }
  for (const action of actions) {
    if (action.type === 'activateTrap') {
      const inst = findInstance(state, action.uid).inst;
      const card = cardOf(inst);
      onBoard.set(action.uid, action);
      cardButton(group, card, `罠「${card.name}」を発動`, card.text, () => submit(action));
    }
  }
  if (group.childElementCount > 0) bar.append(group);
  game.targeting = { onBoard, offBoard: [], playerZone: null, prompt: null, passive: true };

  const pass = actions.find((a) => a.type === 'pass');
  if (pass) {
    bar.append(el('div', 'actionbar__spacer'));
    hotkeyButton(bar, group.childElementCount > 0 ? '何もせず攻撃を通す' : '攻撃を通す', () => submit(pass), { primary: true, key: 'E' });
  }
}

function renderTriggerBar(bar) {
  const { state, targeting } = game;
  const uid = state.pending.queue[0];
  const found = findInstance(state, uid);
  const card = found ? cardOf(found.inst) : null;

  if (targeting) return renderTargetingBar(bar);

  if (card) {
    bar.append(el('span', 'actionbar__prompt', `シールドトリガー「${card.name}」。コストなしで使えます`));
    const preview = el('div', 'actionbar__cards');
    const mini = cardEl(card, { mini: true });
    mini.tabIndex = -1;
    preview.append(mini, el('span', 'actionbar__note', card.text || ''));
    bar.append(preview);
  }

  const actions = legalActions(state);
  const uses = actions.filter((a) => a.type === 'useTrigger');
  if (uses.length > 0) {
    hotkeyButton(bar, '使う', () => {
      if (uses.length === 1 && !uses[0].targetUid) return submit(uses[0]);
      beginTargeting(uses, '効果の対象を選んでください');
    }, { primary: true });
  } else if (card) {
    // 対象がいないなど、条件を満たさず発動できない場合は理由を示す
    bar.append(el('span', 'actionbar__note', '効果の対象がいないため、このトリガーは使えません'));
  }

  const skip = actions.find((a) => a.type === 'skipTrigger');
  if (skip) {
    const label = uses.length > 0 ? '使わず手札に加える' : '手札に加えて続ける';
    hotkeyButton(bar, label, () => submit(skip), { primary: uses.length === 0 });
  }
}

/* ================================================================== *
 * 選択と対象指定
 * ================================================================== */

const INTENT_LABEL = {
  charge: 'マナに置く',
  'play:attack': '攻撃表示で召喚',
  'play:defense': '守備表示で召喚',
  'play:spell': '唱える',
  'play:trap': '伏せる',
  changePosition: '表示形式を変える',
  attack: '攻撃する',
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
    ? '攻撃先を選んでください。相手のシールドか、タップ中／守備表示のクリーチャー'
    : '効果の対象を選んでください';
  beginTargeting(intent.actions, prompt);
}

/**
 * 対象選択モードに入る。
 * 盤面に見えている対象はハイライトし、墓地など見えない対象はレールに並べる。
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
    else if (found) {
      const zoneName = { grave: '墓地', hand: '手札', mana: 'マナ', shields: 'シールド', traps: '伏せ' }[found.zone] || found.zone;
      offBoard.push({ action, card: cardOf(found.inst), note: `${state.players[found.player].name} の${zoneName}` });
    }
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
    zone.removeAttribute('role');
    zone.removeAttribute('tabindex');
  }

  if (!game.targeting) return;
  const { onBoard, playerZone } = game.targeting;

  for (const [uid, action] of onBoard) {
    const node = document.querySelector(`#screen-duel .card[data-uid="${uid}"]`);
    if (!node) continue;
    node.classList.add('is-target');
    node.setAttribute('aria-label', `${node.getAttribute('aria-label')}、対象に選べる`);
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
    $('btn-handoff').focus();
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
  node.setAttribute('role', 'status');
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
    toast(`シールドブレイク ×${event.count}`);
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
  if (destroyed.length > 0 && event.type !== 'shieldBreak') toast('クリーチャー破壊');
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
  if (!game.coachDone) {
    game.coachDone = true;
    savePrefs({ coachDone: true });
  }
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
      ? (won ? '勝利' : '敗北')
      : `${winner.name} の勝利`;
    detail.textContent = state.winReason === 'deckout'
      ? `${state.players[opponentOf(state.winner)].name} の山札が尽きました。`
      : `${winner.name} のダイレクトアタックが決まりました（${state.turn}ターン）。`;
  }
  box.hidden = false;
  $('btn-rematch').focus();
}

/* ================================================================== *
 * 盤面のクリックとキーボード
 * ================================================================== */

document.addEventListener('click', (event) => {
  if (!game) return;
  if ($('screen-duel').classList.contains('is-active') === false) return;

  // レールのボタンなどは、自分の click ハンドラの中で render() を呼び、
  // その時点で DOM から取り除かれる。ここまでバブリングしてきた時点では
  // すでに document から切り離されているため closest() が効かない。
  // 「切り離された要素からのイベント＝すでに処理済み」とみなして無視する。
  if (!event.target.isConnected) return;

  const cardNode = event.target.closest('#me-hand .card, #screen-duel .zone--field .card');
  if (!cardNode || !cardNode.dataset.uid) {
    if (event.target.closest('#rail') || event.target.closest('.overlay')) return;
    if (game.selection || (game.targeting && !game.targeting.passive)) {
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

/**
 * キーボード操作。
 *   Esc … 選択・対象指定をやめる
 *   E   … ターン終了（または攻撃を通す）
 *   1-9 … レールに並んだ選択肢
 * カード自体は <button> なので、Tab と Enter で選べる。
 */
function onKeyDown(event) {
  if (!game) return;
  if (!$('screen-duel').classList.contains('is-active')) return;
  if (!$('handoff').hidden || !$('result').hidden) return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const tag = event.target?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  if (event.key === 'Escape') {
    if (game.selection || (game.targeting && !game.targeting.passive)) {
      game.selection = null;
      game.targeting = null;
      render();
      event.preventDefault();
    }
    return;
  }

  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const btn = $('actionbar').querySelector(`[data-hotkey="${key}"]`);
  if (btn) {
    event.preventDefault();
    btn.click();
  }
}
