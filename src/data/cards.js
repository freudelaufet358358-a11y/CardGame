/**
 * カードプール（全40種 / 5文明 × 8種）
 *
 * すべて本作オリジナルのカードです。既存カードゲームの名称・テキスト・
 * イラストは一切使用していません。絵柄は絵文字1文字で表現します。
 *
 * --- カードスキーマ ---
 *   id        : 一意なID
 *   name      : カード名
 *   civ       : 文明 light | water | dark | fire | nature
 *   type      : creature | spell | trap
 *   cost      : マナコスト
 *   power     : パワー（クリーチャーのみ／攻撃表示で使う値）
 *   guard     : ガード（クリーチャーのみ／守備表示で使う値）
 *   keywords  : キーワード能力の配列（KEYWORDS 参照）
 *   emoji     : 絵柄
 *   text      : カードテキスト（表示用）
 *   onSummon  : クリーチャーの召喚時効果（effect descriptor）
 *   effect    : 呪文・罠の効果（effect descriptor）
 *
 * --- effect descriptor ---
 *   { op: '...', ...params }
 *   op が必要とする対象は target フィールドで宣言し、
 *   rules.js が合法な対象ごとにアクションを列挙します。
 */

export const CIVS = {
  light: { name: '光', emoji: '☀️', color: '#e8c766' },
  water: { name: '水', emoji: '💧', color: '#4aa3e0' },
  dark: { name: '闇', emoji: '🟣', color: '#8b6fbf' },
  fire: { name: '火', emoji: '🔥', color: '#e0603c' },
  nature: { name: '自然', emoji: '🌿', color: '#5fae63' },
};

export const KEYWORDS = {
  blocker: {
    name: 'ブロッカー',
    text: '相手クリーチャーの攻撃を、このクリーチャーをタップして代わりに受けられる。',
  },
  speed: {
    name: 'スピードアタッカー',
    text: '出したターンから攻撃できる（召喚酔いしない）。',
  },
  doubleBreaker: {
    name: 'W・ブレイカー',
    text: 'シールドを1度に2枚ブレイクする。',
  },
  trigger: {
    name: 'シールドトリガー',
    text: 'シールドがブレイクされたとき、コストを支払わずに使ってもよい。',
  },
  slayer: {
    name: 'スレイヤー',
    text: 'バトルした相手クリーチャーを、パワーに関係なく破壊する。',
  },
};

/** 攻撃宣言時に発動できる罠のトリガー名 */
export const TRAP_TRIGGER_ON_ATTACK = 'onAttack';

const CARD_LIST = [
  // ==========================================================
  // 光 — ブロッカーとタップによる防御・遅延
  // ==========================================================
  {
    id: 'li01', name: '聖光の歩哨 ルミナ', civ: 'light', type: 'creature',
    cost: 1, power: 2000, guard: 3000, keywords: ['blocker'], emoji: '🛡️',
    text: 'ブロッカー',
  },
  {
    id: 'li02', name: '白翼の守護者 セラフィナ', civ: 'light', type: 'creature',
    cost: 3, power: 3000, guard: 5000, keywords: ['blocker'], emoji: '🕊️',
    text: 'ブロッカー',
  },
  {
    id: 'li03', name: '光輪の審判者 ジャッジメント', civ: 'light', type: 'creature',
    cost: 5, power: 5000, guard: 6000, keywords: ['blocker'], emoji: '⚖️',
    text: 'ブロッカー / 召喚時、相手のクリーチャー1体をタップする。',
    onSummon: { op: 'tap', target: 'enemyCreature' },
  },
  {
    id: 'li04', name: '閃光の大天使 ラディアス', civ: 'light', type: 'creature',
    cost: 7, power: 9000, guard: 7000, keywords: ['blocker', 'doubleBreaker'], emoji: '👼',
    text: 'ブロッカー / W・ブレイカー',
  },
  {
    id: 'li05', name: 'ホーリー・バリア', civ: 'light', type: 'spell',
    cost: 2, keywords: ['trigger'], emoji: '✨',
    text: 'シールドトリガー / 相手のクリーチャーをすべてタップする。',
    effect: { op: 'tapAll', side: 'enemy' },
  },
  {
    id: 'li06', name: '光明の加護', civ: 'light', type: 'spell',
    cost: 1, keywords: ['trigger'], emoji: '🔆',
    text: 'シールドトリガー / 自分の山札の上から1枚を新しいシールドとして追加する。',
    effect: { op: 'addShield', n: 1 },
  },
  {
    id: 'li07', name: '聖裁の鐘', civ: 'light', type: 'spell',
    cost: 3, keywords: ['trigger'], emoji: '🔔',
    text: 'シールドトリガー / タップされている相手クリーチャー1体を破壊する。'
      + '（攻撃したクリーチャーはタップされるので、シールドトリガーで発動すれば'
      + 'その攻撃クリーチャーを討ち取れる）',
    effect: { op: 'destroy', target: 'enemyTappedCreature' },
  },
  {
    id: 'li08', name: '反射の護符', civ: 'light', type: 'trap',
    cost: 2, keywords: [], emoji: '🪞', trapTrigger: TRAP_TRIGGER_ON_ATTACK,
    text: '【罠】相手の攻撃宣言時に発動。その攻撃を無効にし、攻撃クリーチャーをタップする。',
    effect: { op: 'negateAttack', tapAttacker: true },
  },

  // ==========================================================
  // 水 — ドローとバウンス
  // ==========================================================
  {
    id: 'wa01', name: '深海の斥候 アクア', civ: 'water', type: 'creature',
    cost: 1, power: 1000, guard: 2000, keywords: [], emoji: '🐟',
    text: '召喚時、カードを1枚引く。',
    onSummon: { op: 'draw', n: 1 },
  },
  {
    id: 'wa02', name: '潮流のマーフォーク', civ: 'water', type: 'creature',
    cost: 2, power: 2000, guard: 2000, keywords: [], emoji: '🧜',
    text: '召喚時、コスト2以下の相手クリーチャー1体を手札に戻す。',
    onSummon: { op: 'bounce', target: 'enemyCreature', maxCost: 2 },
  },
  {
    id: 'wa03', name: '渦潮の術士 ティデ', civ: 'water', type: 'creature',
    cost: 4, power: 3000, guard: 3000, keywords: [], emoji: '🌀',
    text: '召喚時、カードを2枚引く。',
    onSummon: { op: 'draw', n: 2 },
  },
  {
    id: 'wa04', name: '蒼海の巨鯨 リヴァイア', civ: 'water', type: 'creature',
    cost: 6, power: 7000, guard: 6000, keywords: ['doubleBreaker'], emoji: '🐋',
    text: 'W・ブレイカー / 召喚時、カードを1枚引く。',
    onSummon: { op: 'draw', n: 1 },
  },
  {
    id: 'wa05', name: 'サイクロン・ドロー', civ: 'water', type: 'spell',
    cost: 3, keywords: [], emoji: '📘',
    text: 'カードを3枚引く。',
    effect: { op: 'draw', n: 3 },
  },
  {
    id: 'wa06', name: 'リターン・ウェイブ', civ: 'water', type: 'spell',
    cost: 2, keywords: ['trigger'], emoji: '🌊',
    text: 'シールドトリガー / 相手のクリーチャー1体を手札に戻す。',
    effect: { op: 'bounce', target: 'enemyCreature' },
  },
  {
    id: 'wa07', name: '知識の泉', civ: 'water', type: 'spell',
    cost: 1, keywords: ['trigger'], emoji: '💧',
    text: 'シールドトリガー / カードを1枚引く。',
    effect: { op: 'draw', n: 1 },
  },
  {
    id: 'wa08', name: '幻影の罠', civ: 'water', type: 'trap',
    cost: 2, keywords: [], emoji: '🫧', trapTrigger: TRAP_TRIGGER_ON_ATTACK,
    text: '【罠】相手の攻撃宣言時に発動。その攻撃を無効にし、攻撃クリーチャーを手札に戻す。',
    effect: { op: 'negateAttack', bounceAttacker: true },
  },

  // ==========================================================
  // 闇 — 破壊・墓地利用・手札破壊
  // ==========================================================
  {
    id: 'da01', name: '屍拾いのグール', civ: 'dark', type: 'creature',
    cost: 2, power: 2000, guard: 1000, keywords: [], emoji: '🧟',
    text: '召喚時、自分の墓地からクリーチャー1体を手札に戻す。',
    onSummon: { op: 'graveToHand', target: 'ownGraveCreature' },
  },
  {
    id: 'da02', name: '影刃のアサシン', civ: 'dark', type: 'creature',
    cost: 4, power: 3000, guard: 2000, keywords: ['slayer'], emoji: '🗡️',
    text: 'スレイヤー',
  },
  {
    id: 'da03', name: '疫病の使徒 ペスト', civ: 'dark', type: 'creature',
    cost: 5, power: 4000, guard: 2000, keywords: [], emoji: '☠️',
    text: '召喚時、コスト3以下の相手クリーチャー1体を破壊する。',
    onSummon: { op: 'destroy', target: 'enemyCreature', maxCost: 3 },
  },
  {
    id: 'da04', name: '冥界の支配者 ネクロス', civ: 'dark', type: 'creature',
    cost: 7, power: 8000, guard: 5000, keywords: ['doubleBreaker'], emoji: '👑',
    text: 'W・ブレイカー / 召喚時、相手のクリーチャー1体を破壊する。',
    onSummon: { op: 'destroy', target: 'enemyCreature' },
  },
  {
    id: 'da05', name: 'デス・スラッシュ', civ: 'dark', type: 'spell',
    cost: 4, keywords: ['trigger'], emoji: '🌑',
    text: 'シールドトリガー / 相手のクリーチャー1体を破壊する。',
    effect: { op: 'destroy', target: 'enemyCreature' },
  },
  {
    id: 'da06', name: '精神侵蝕', civ: 'dark', type: 'spell',
    cost: 2, keywords: [], emoji: '🕷️',
    text: '相手は自分の手札を無作為に1枚捨てる。',
    effect: { op: 'discardRandom', n: 1 },
  },
  {
    id: 'da07', name: '魂の代償', civ: 'dark', type: 'spell',
    cost: 5, keywords: [], emoji: '🔮',
    text: 'このターン、相手のクリーチャーすべてのパワーを-2000する。',
    effect: { op: 'debuffAll', side: 'enemy', power: -2000 },
  },
  {
    id: 'da08', name: '呪縛の罠', civ: 'dark', type: 'trap',
    cost: 3, keywords: [], emoji: '⛓️', trapTrigger: TRAP_TRIGGER_ON_ATTACK,
    text: '【罠】相手の攻撃宣言時に発動。その攻撃を無効にし、攻撃クリーチャーを破壊する。',
    effect: { op: 'negateAttack', destroyAttacker: true },
  },

  // ==========================================================
  // 火 — スピードアタッカーと高パワー
  // ==========================================================
  {
    id: 'fi01', name: '爆炎の小鬼 ボム', civ: 'fire', type: 'creature',
    cost: 1, power: 2000, guard: 0, keywords: ['speed'], emoji: '👹',
    text: 'スピードアタッカー',
  },
  {
    id: 'fi02', name: '紅蓮の剣士 フレイム', civ: 'fire', type: 'creature',
    cost: 3, power: 3000, guard: 1000, keywords: ['speed'], emoji: '🔥',
    text: 'スピードアタッカー',
  },
  {
    id: 'fi03', name: '業火の戦鬼 イグニス', civ: 'fire', type: 'creature',
    cost: 5, power: 6000, guard: 2000, keywords: ['doubleBreaker'], emoji: '🐗',
    text: 'W・ブレイカー',
  },
  {
    id: 'fi04', name: '灼熱竜 ヴォルカニクス', civ: 'fire', type: 'creature',
    cost: 7, power: 9000, guard: 4000, keywords: ['doubleBreaker', 'speed'], emoji: '🐉',
    text: 'W・ブレイカー / スピードアタッカー',
  },
  {
    id: 'fi05', name: 'ファイア・ブラスト', civ: 'fire', type: 'spell',
    cost: 2, keywords: ['trigger'], emoji: '💥',
    text: 'シールドトリガー / コスト4以下の相手クリーチャー1体を破壊する。',
    effect: { op: 'destroy', target: 'enemyCreature', maxCost: 4 },
  },
  {
    id: 'fi06', name: '焦土の雄叫び', civ: 'fire', type: 'spell',
    cost: 3, keywords: [], emoji: '⚔️',
    text: 'このターン、自分のクリーチャーすべてのパワーを+2000する。',
    effect: { op: 'buffAll', side: 'self', power: 2000 },
  },
  {
    id: 'fi07', name: '双撃の号令', civ: 'fire', type: 'spell',
    cost: 5, keywords: [], emoji: '🎺',
    text: '自分のクリーチャーをすべてアンタップする。（攻撃済みのクリーチャーはもう一度攻撃できる）',
    effect: { op: 'untapAll', side: 'self' },
  },
  {
    id: 'fi08', name: '反撃の烽火', civ: 'fire', type: 'trap',
    cost: 2, keywords: [], emoji: '🎇', trapTrigger: TRAP_TRIGGER_ON_ATTACK,
    text: '【罠】相手の攻撃宣言時に発動。このターン、攻撃クリーチャーのパワーを-4000する。',
    effect: { op: 'debuffAttacker', power: -4000 },
  },

  // ==========================================================
  // 自然 — マナ加速と最高パワー帯
  // ==========================================================
  {
    id: 'na01', name: '森の芽吹き', civ: 'nature', type: 'spell',
    cost: 2, keywords: ['trigger'], emoji: '🌱',
    text: 'シールドトリガー / 自分の山札の上から1枚をマナゾーンに置く。',
    effect: { op: 'manaBoost', n: 1 },
  },
  {
    id: 'na02', name: '大地の巡礼者', civ: 'nature', type: 'creature',
    cost: 2, power: 2000, guard: 2000, keywords: [], emoji: '🧝',
    text: '召喚時、自分の山札の上から1枚をマナゾーンに置く。',
    onSummon: { op: 'manaBoost', n: 1 },
  },
  {
    id: 'na03', name: '苔むす守り手 モスガード', civ: 'nature', type: 'creature',
    cost: 3, power: 2000, guard: 6000, keywords: ['blocker'], emoji: '🪨',
    text: 'ブロッカー / 分厚い苔の甲羅は、並の攻撃をすべて跳ね返す。',
  },
  {
    id: 'na04', name: '古樹の賢者 エルダー', civ: 'nature', type: 'creature',
    cost: 4, power: 5000, guard: 3000, keywords: [], emoji: '🌳',
    text: '召喚時、自分の山札の上から1枚をマナゾーンに置く。'
      + '同コスト帯では最高クラスのパワーを持つ。',
    onSummon: { op: 'manaBoost', n: 1 },
  },
  {
    id: 'na05', name: '巨獣ベヒモス', civ: 'nature', type: 'creature',
    cost: 5, power: 7000, guard: 6000, keywords: ['doubleBreaker'], emoji: '🦣',
    text: 'W・ブレイカー',
  },
  {
    id: 'na06', name: '森羅の覇王 ガイアロード', civ: 'nature', type: 'creature',
    cost: 7, power: 11000, guard: 8000, keywords: ['doubleBreaker'], emoji: '🌏',
    text: 'W・ブレイカー / 召喚時、このターン自分のクリーチャーすべてのパワーを+2000する。',
    onSummon: { op: 'buffAll', side: 'self', power: 2000 },
  },
  {
    id: 'na07', name: '大地の抱擁', civ: 'nature', type: 'spell',
    cost: 4, keywords: ['trigger'], emoji: '🍃',
    text: 'シールドトリガー / 相手のクリーチャー1体を、持ち主のマナゾーンに置く。'
      + '（破壊ではないので墓地から戻されないが、相手のマナは1枚増える）',
    effect: { op: 'toMana', target: 'enemyCreature' },
  },
  {
    id: 'na08', name: '茨の防壁', civ: 'nature', type: 'trap',
    cost: 2, keywords: [], emoji: '🌵', trapTrigger: TRAP_TRIGGER_ON_ATTACK,
    text: '【罠】相手の攻撃宣言時に発動。その攻撃を無効にし、自分のシールドを1枚追加する。',
    effect: { op: 'negateAttack', addShield: 1 },
  },
];

/** id -> カード定義 */
export const CARDS = Object.freeze(
  Object.fromEntries(CARD_LIST.map((c) => [c.id, Object.freeze(c)])),
);

/** 表示順を保った全カード配列 */
export const ALL_CARDS = Object.freeze(CARD_LIST.map((c) => CARDS[c.id]));

export function getCard(id) {
  const card = CARDS[id];
  if (!card) throw new Error(`未知のカードID: ${id}`);
  return card;
}

export function hasKeyword(card, keyword) {
  return Array.isArray(card.keywords) && card.keywords.includes(keyword);
}
