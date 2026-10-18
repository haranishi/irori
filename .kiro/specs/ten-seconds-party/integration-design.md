# SDKと既存コンソールへの追加契約

要件3〜7のための設計案。WebSocketや部屋のデータ形式は変更しない。

## 終了の型
```ts
interface GameResult {
  p:PlayerId; score:number; label?:string; ranked?:boolean;
}
interface GameEndOptions {
  display?:'points'|'record';
  outcome?:'complete'|'incomplete';
  note?:string;
}
interface HostEnvironment { connected:boolean; visible:boolean }
type HostCapability = 'result-options-v1'|'host-environment-v1';
// Iroriへの追加
// readonly capabilities:readonly HostCapability[]
// readonly environment:Readonly<HostEnvironment>|null
// on('environment', (value:Readonly<HostEnvironment>) => void):() => void
// end(results?:readonly GameResult[], options?:GameEndOptions):void
```

MessagePortのendにoptional optionsを加え、GameFrameのendイベントからconsoleまで保持する。
GameResultの省略rankedはtrue、options省略はpoints/complete/注記なしとして解釈する。
省略値を送信データへ補わない。旧形式のendには新しいキーを一切加えない。

## 終了データの検証
`packages/protocol/src/end.ts` に結果・optionsの共通検証を置く。SDK送信前とhost-bridge受信時に使う。
入力unknownから `{ok:true,results,options?}|{ok:false,reason:string}` を返し、既知キーだけで再構成する。
従来の最大8行、pの範囲と重複禁止、有限score、labelの12文字を維持する。
rankedはbooleanのみ。optionsは上記のenumと120文字以内のnoteだけ。未知キー・HTMLとしての解釈を許さない。
display=recordでは全行にlabelを必須とする。本文上限の検証は既存の文字数関数を使う。
従来のcheckResultsとvalidateGameToHostはこの判定を共有し、2か所で規則が分岐しないようにする。

## 順位と結果の表示
ranked=trueの行だけをscore降順で比較する。同scoreは同順位。除外行は最後に席番号順で載せ、rank=null。
outcome=incompleteでは全員rank=nullとし、「勝敗なし」を表示。人数不足の理由と遅延の注記をnoteへ渡す。
display=recordではlabelを主記録にし、「点」と内部scoreを描画・読み上げに出さない。
rank=nullの行は「—」とし、優勝の強調をしない。退出は既存lineupが保持する元の名前と「退出」で識別する。
本ゲームのscoreは負の累計整数。noteは「通信の遅れを含む目安です」。同じ値なら順番で優劣を付けない。
ゲーム独自の順位を上流へ持ち込まず、コンソールは汎用のscore/ranked/displayだけを解釈する。
結果画面の再戦・ホーム・共有は既存の操作を使う。共有文へoptions.noteや行データは渡さない。
mockの終了表示も同じranked/display/outcome/noteの意味を守る。SDKからwebの実装をimportしない。

## 環境スナップショット
HostToGameのinitにoptional capabilities/environmentを加え、更新は `{m:'environment',environment:HostEnvironment}`。
connectedはRoomLinkのwelcome後にtrue、lost/offline/replacedでfalse。visibleは親documentのvisibilityStateで決める。
consoleは変化ごとに即時送信し、false→trueを1回のrenderへまとめて失わない。
復帰welcomeでは参加者の再照合・players通知を先に済ませ、その後connected=trueを送る。
新SDKは初期値をgetterに保持し、変化時にenvironmentイベントを出す。購読前の状態もゲームが読める。
GameFrameは握手前の変化を最新initへ保持する。型が不正な環境更新は適用しない。
メニュー用pause/resumeとpaused、machineのphase、padOwnerは従来の意味を保つ。
環境が戻ってもresumeイベントを合成しない。ゲームのblockersを解消するだけで、計測は自動で始めない。
mockではconnected=true、自分のdocumentの表示状態を使う。単体試験では環境イベントを直接注入できる。
共用画面の再読み込みは既存どおりゲームを破棄し、ホームへ戻る。

## 互換性と起動
BRIDGE_VERSION=1・registry sdk=1を維持する。新ホストはinitで両capabilityを広告する。
旧SDKはinitの追加情報と新イベントを無視でき、既存4本の意味を変えない。
新SDKが旧ホストへ接続したらcapabilities=[]・environment=null。新ゲームは両capabilityを開始前に確認する。
不足時は説明画面に更新の案内を出し、「はじめる」を出さない。既存のメニューからホームへ戻れる。
拡張endを非対応ホストへ送る場合は送信前にIroriError('unsupported-feature')。省略された旧endは従来どおり通す。
SDKの実装型と手書きirori.d.ts、型公開、mock、host、検証規則を同時に更新する。
既存同期ツールで全同梱ゲームと公開SDKを再生成する。配布先のirori.js/d.tsを手で編集しない。
新ゲームと更新後のSDK・hostを同じビルドへ含める。データ移行・新規依存・Workerの設定変更はない。

## 実装時の確認点
メニュー中の切断→復帰、非表示中の復帰、接続前から非表示、複数理由の解除順で、自動再開しない。
プレイヤーの再利用とleader更新は既存lineup/rosterに従う。ゲームはplayersイベントのleaderを使用する。
旧4本のendを固定fixtureで比較し、点数表示・順位・未完走者の従来の意味を変えない。
注記・記録をtextContentで描き、長さ・未知キー・null・配列・NaNを契約境界で検証する。
