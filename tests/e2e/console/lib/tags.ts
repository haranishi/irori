// 試験の札。playwright.config.ts の各組は、自分の札が付いた試験だけを流す（grep）。
// HOST はホストが主役の試験（デスクトップの2組）、PHONE はスマホが主役の試験（電話の2組）。
// CDP（タッチの合成・CPUを遅くする）を使う試験は、Chromium の組だけに付ける。
export const DC = '@desktop-chromium';
export const DW = '@desktop-webkit';
export const PC = '@phone-chromium';
export const PW = '@phone-webkit';

export const HOST = { tag: [DC, DW] };
export const PHONE = { tag: [PC, PW] };
export const ONLY_DC = { tag: [DC] };
export const ONLY_PC = { tag: [PC] };
export const ALL = { tag: [DC, DW, PC, PW] };
