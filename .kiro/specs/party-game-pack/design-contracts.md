# 契約：tiles と cue-v1

要件 2・3。型と上限は `packages/protocol`（`types.ts` `limits.ts` `validate.ts` `bridge.ts`）に入っている。この文書は、その上に載せる動作を決める。

## tiles（コントローラーの第7の種類・能力 `pad-tiles-v1`）
型：`{ k:'tiles', tiles: TileSpec[], ok, pass?, min?, max?, note?, hint?, disabled? }`。`TileSpec` は `{ id, label, sub?, color?, off? }`。入力は `{ k:'tiles', ids, pass? }` を、決定かパスで1回だけ送る。
- 上限：札20個、一度に選ぶ数8、文字（label・sub・ok・pass）12、note 120、hint 40。識別子は小文字・数字・`_`・`-` の24文字まで、重複しない。`min` 既定1・`max` 既定1（選べる札が無ければ0）。`min ≤ max ≤ min(8, off でない札の数)`。札が空なら、文と決定だけの画面。
- 検証：スマホ・中継・ホストの橋・SDK が同じ関数（`validatePadSpec` と入力の検証）を共有する。未知のキー・重複・範囲外は拒む。独立した検証器（`fuzz.test.ts`）にも同じ規則を足す。

### スマホの動作（`packages/pad-ui`）
- 札の押下で選択と解除。`max` が1なら別の札を押すと入れ替わる。上限に達していて追加で押したら、札は選ばれず、`aria-live` で「これ以上選べません」を伝え、札の枠が一瞬変わる（動きを減らす設定では揺らさない）。
- 選択中は、太い枠とチェック印と `aria-pressed="true"`。色だけに頼らない。`off` は薄く、`aria-disabled`、押せない。
- 決定：選択数が `min`〜`max` のときだけ押せる。押すと `{ids}` を送り、画面全体を「送りました」の状態にして、次の画面が来るまで何も押せない。パス：`pass` があれば常に押せる。押すと `{ids: [], pass: true}` を送る。
- `disabled`：札は見るだけ。決定とパスは出さない。`note` と `hint` はいつでも出す。
- 新しい画面（同じ内容でも）が来たら、選択を空にして描き直す。再接続時も、同じ札を選択なしで戻す（再送の省略に注意）。
- 配置：札は幅に応じて3〜5列の格子。20個でも390px幅で欠けず、札の領域だけが縦に動く。決定とパスは画面の下に固定。札の最小の大きさは56px。キーボードは Tab・Space・Enter。文言は日英（pad-ui の `PadStrings` に足す）。
- 棚の表示：ホストの棚が出す、ゲームの対応コントローラーの印（`PAD_ICON`・日英の名称）に `tiles` を足す。

### SDK
- `setPad` に `tiles` を渡すとき、能力 `pad-tiles-v1` が無ければ送る前に `unsupported-feature` で断る（旧ホスト）。ゲームは `irori.capabilities` を見て、無ければ「更新が必要です」の `wait` を出して待つ。
- 仮想プレイヤー（`?mock=N`）は、能力を全部持つ。`tiles` を、矢印キーで札を動き、Space で選択、Enter で決定、P でパスで試せる。クリックでも操作できる。
- `irori.d.ts` を手書きで同じ形に更新する（`tests/types/api-match.ts` が実装と一致を守る）。

## cue-v1（効果音の依頼）
- 名前は固定の一覧（`bridge.ts` の `CUES`）。ゲームは `irori.cue(name, v?)` で頼む。`v` は強さ0〜1で、省略時は0.7。
- SDK：能力が無ければ何もしない（例外を出さない）。同じ名前は50ms以内に重ねず、全体で毎秒20件までに絞る。
- ホストの橋：形式の誤り（未知の名前・範囲外の `v`・余分なキー）は、既存のメッセージと同じ扱いで違反として数える。頻度の超過は黙って捨てる。
- コンソール：鳴らす条件は、消音でなく、AudioContext が使え、ゲームが前面（一時停止やメニューが無い）のとき。条件に合わなければ黙って捨てる。
- 音は、`apps/web/src/host/audio.ts` が WebAudio の振動子・ノイズ・フィルタ・包絡だけで合成する。各 cue は1.5秒以内、ピークはフルスケールの0.7以下。同じ cue でも高さを±3%ふらつかせる。音声ファイルは足さない。聞こえ方の評価は人の耳で行う（未検証として記録する）。
- 試験：全 cue を `OfflineAudioContext` で描き、無音でない・ピークの上限・長さの上限を確かめる。消音と未解除では鳴らさないこと。一覧の外の名前は届かないこと。

## SDKの容量
SDKの配布ファイルは、読める形のまま1ファイルで配る。tiles と cue を足すと60,000バイトの上限を超えるため、**生の上限を72,000バイトに上げる**（`packages/sdk/tests/build.test.ts`・`tools/check-budgets.mjs`・`docs/architecture.md`）。gzipの上限（60KB）は変えない。理由と選ばなかった案は `docs/decisions/0009-party-pack-platform.md` に書く。
