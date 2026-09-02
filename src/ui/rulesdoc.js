/**
 * 「遊びかた」画面。ルール説明とカード一覧を生成する。
 * ルールの数値（シールド枚数など）は engine から読むので、実装とズレない。
 */

import { ALL_CARDS, CIVS, KEYWORDS } from '../data/cards.js';
import { DECK_SIZE, MAX_COPIES } from '../data/decks.js';
import { INITIAL_HAND, INITIAL_SHIELDS, MAX_FIELD, MAX_TRAPS } from '../engine/state.js';
import { cardEl, el } from './cardview.js';

export function renderRules(container) {
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <p>
      <b>SHIELD BREAK DUEL</b> は、デュエル・マスターズの「マナ／シールド」と、
      遊☆戯☆王の「攻撃表示・守備表示／伏せカード」を組み合わせたオリジナルの
      対戦型カードゲームです。既存カードの名称・イラスト・テキストは使っていません。
    </p>

    <h3>勝ち方</h3>
    <ul>
      <li>相手の<b>シールドを${INITIAL_SHIELDS}枚すべて割り</b>、さらにもう一度攻撃を通せば勝ちです（ダイレクトアタック）。</li>
      <li>相手の<b>山札が尽きて引けなくなった</b>ときも勝ちです。</li>
    </ul>

    <h3>準備</h3>
    <ul>
      <li>デッキは<b>ちょうど${DECK_SIZE}枚</b>、同じカードは<b>${MAX_COPIES}枚まで</b>。</li>
      <li>山札の上から<b>${INITIAL_SHIELDS}枚がシールド</b>（中身は自分にも見えません）。</li>
      <li>そのあと<b>${INITIAL_HAND}枚</b>を手札にして開始。先攻の最初のターンはドローしません。</li>
    </ul>

    <h3>ターンの流れ</h3>
    <ol>
      <li><b>アンタップ</b> ― 自分のクリーチャーとマナがすべて起き上がります。</li>
      <li><b>ドロー</b> ― 1枚引きます。</li>
      <li><b>マナチャージ</b> ― 手札から<b>1ターンに1枚だけ</b>マナゾーンに置けます。置いたマナはそのターンから使えます。</li>
      <li><b>メイン</b> ― マナを支払ってカードを使い、クリーチャーで攻撃します。
        本作ではメイン中ならいつでも召喚も攻撃もでき、順番は自由です。</li>
      <li><b>ターン終了</b> ― そのターンだけのパワー修整が消えます。手札の上限はありません。</li>
    </ol>

    <h3>コストの支払いかた</h3>
    <p>
      カードを使うには、<b>コストと同じ枚数のマナをタップ</b>し、そのうち<b>1枚以上は
      そのカードと同じ文明</b>でなければなりません。たとえば「火・コスト4」のカードには、
      火のマナを1枚以上含む合計4枚のマナが必要です。
      どのマナをタップするかは自動で選ばれ、少数派の文明のマナは温存されます。
    </p>

    <h3>クリーチャーと表示形式</h3>
    <table>
      <tr><th></th><th>攻撃表示</th><th>守備表示</th></tr>
      <tr><td>攻撃</td><td>できる</td><td>できない</td></tr>
      <tr><td>攻撃を受けたときの値</td><td><b>パワー</b></td><td><b>ガード</b></td></tr>
      <tr><td>相手に狙われるか</td><td>タップ中のときだけ狙われる</td><td>いつでも狙われる</td></tr>
    </table>
    <ul>
      <li>召喚したターンは攻撃できません（<b>召喚酔い</b>）。スピードアタッカーは例外です。</li>
      <li><b>攻撃するとタップされます</b>。だから攻撃した次の瞬間は、相手に狙われる隙になります。</li>
      <li>表示形式の変更は、召喚したターン以外に、タップしていないクリーチャー1体につき1ターン1回。</li>
      <li>バトルゾーンは最大${MAX_FIELD}体、伏せカードは最大${MAX_TRAPS}枚です。</li>
    </ul>

    <h3>攻撃と対象</h3>
    <ul>
      <li>攻撃先は<b>相手プレイヤー（シールド）</b>か<b>相手クリーチャー</b>から選びます。</li>
      <li>ただしクリーチャーを狙えるのは、そのクリーチャーが<b>タップされている</b>か
        <b>守備表示</b>のときだけです。攻撃表示で起きているクリーチャーは正面から殴れません。</li>
      <li>相手は<b>ブロッカー</b>を1体タップして、攻撃を代わりに受けられます。
        ブロックは守りの行動なので、ブロッカーは<b>ガードの値</b>で戦います。</li>
      <li>バトルは値が大きいほうが勝ち、負けたほうは破壊されます。<b>同じ値なら相打ち</b>です。</li>
      <li>パワーが0以下になったクリーチャーは破壊されます。</li>
    </ul>

    <h3>シールドとシールドトリガー</h3>
    <ul>
      <li>プレイヤーへの攻撃が通ると<b>シールドが1枚割れ</b>、そのカードは<b>持ち主の手札に入ります</b>
        （W・ブレイカーなら2枚）。</li>
      <li>割れたカードが<b>シールドトリガー</b>を持っていれば、<b>コストを支払わずその場で使えます</b>。
        これが逆転の要です。</li>
      <li>攻撃した相手のクリーチャーはタップされているので、
        「タップされているクリーチャーを破壊する」トリガーは攻撃してきた相手を討ち取れます。</li>
    </ul>

    <h3>伏せカード（罠）</h3>
    <p>
      罠はメイン中にコストを払って伏せておき、<b>相手の攻撃宣言時</b>にコストなしで発動できます。
      攻撃を無効にしたり、攻撃クリーチャーを破壊・手札に戻したりできます。
    </p>

    <h3>キーワード能力</h3>
    <div class="kwlist">
      ${Object.values(KEYWORDS).map((k) => `<div><b>${k.name}</b> ― ${k.text}</div>`).join('')}
    </div>

    <h3>文明</h3>
    <table>
      <tr><th>文明</th><th>得意なこと</th></tr>
      <tr><td><i class="civmark" style="--civ:var(--civ-light)"></i>光</td><td>ブロッカー、相手のタップ、タップ中の相手の除去</td></tr>
      <tr><td><i class="civmark" style="--civ:var(--civ-water)"></i>水</td><td>ドロー、相手クリーチャーを手札に戻す</td></tr>
      <tr><td><i class="civmark" style="--civ:var(--civ-dark)"></i>闇</td><td>破壊、墓地の再利用、手札破壊</td></tr>
      <tr><td><i class="civmark" style="--civ:var(--civ-fire)"></i>火</td><td>スピードアタッカー、高いパワー、シールドブレイク</td></tr>
      <tr><td><i class="civmark" style="--civ:var(--civ-nature)"></i>自然</td><td>マナ加速、最高クラスのパワー、マナ送りの除去</td></tr>
    </table>

    <h3>操作方法</h3>
    <ul>
      <li>カードを<b>押す</b>と、そのカードでできることが右の「行動」に並びます。</li>
      <li>効果や攻撃の対象が必要なときは、<b>破線で点滅している</b>カードやシールドを押します。同じ選択肢は「行動」にもボタンで並ぶので、どちらから選んでもかまいません。</li>
      <li>横倒しのクリーチャーは<b>タップ済み</b>（このターンはもう動けない）、帯が付いたクリーチャーは<b>召喚酔い</b>です。</li>
      <li>カードに<b>マウスを乗せる</b>（スマホなら<b>長押し</b>）と、詳しい説明が出ます。</li>
      <li>キーボードでも遊べます。<b>Tab</b> でカードを選び <b>Enter</b> で決定、<b>Esc</b> で取り消し、<b>E</b> でターン終了、<b>1〜9</b> で「行動」の選択肢を選びます。</li>
    </ul>

    <h3>カード一覧（全${ALL_CARDS.length}種）</h3>
  `);

  for (const [civ, info] of Object.entries(CIVS)) {
    const cards = ALL_CARDS.filter((c) => c.civ === civ);
    const heading = el('h4');
    const mark = el('i', 'civmark');
    mark.style.setProperty('--civ', `var(--civ-${civ})`);
    heading.append(mark, document.createTextNode(`${info.name}文明`));
    container.append(heading);
    const grid = el('div', 'cardgrid');
    for (const card of cards) grid.append(cardEl(card));
    container.append(grid);
  }
}
