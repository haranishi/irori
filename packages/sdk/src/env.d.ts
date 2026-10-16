// CSS を文字列として取り込む（Vite の ?inline）。仮想プレイヤーの表示に使う。
declare module '*.css?inline' {
  const css: string;
  export default css;
}
