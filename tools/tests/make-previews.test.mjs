import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { activityRate, editPreview, inspectMetadata, makePreviews, motionDifference, parseArgs, replacePreview, verifyPreview } from '../make-previews.mjs';
import { seededRandom } from '../preview-scripts/driver.mjs';

const base = join(process.cwd(), '.probe-tmp');
mkdirSync(base, { recursive: true });
const work = mkdtempSync(join(base, 'preview-tests-'));
after(() => rmSync(work, { recursive: true, force: true }));
const metadata = () => ({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 640, height: 360,
  pix_fmt: 'yuv420p', avg_frame_rate: '30/1' }], format: { duration: '10' } });

const make = (name, source, audio = false) => {
  const file = join(work, `${name}.mp4`);
  const args = ['-n', '10', process.env.IRORI_FFMPEG ?? '/opt/homebrew/bin/ffmpeg',
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', source,
    ...(audio ? ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono'] : []), '-t', '8',
    '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-crf', '35', '-pix_fmt', 'yuv420p',
    ...(audio ? ['-c:a', 'aac'] : ['-an']), '-movflags', '+faststart', file];
  const r = spawnSync('nice', args, { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  return file;
};


describe('動画の引数と出力の境界', () => {
  it('既定の11本と対象の絞り込みを受け取る', () => {
    assert.equal(parseArgs([]).ids.length, 11);
    assert.deepEqual(parseArgs(['--only', 'old-maid']).ids, ['old-maid']);
    assert.equal(parseArgs(['--base-url', 'http://127.0.0.1:8888/']).baseUrl, 'http://127.0.0.1:8888');
    assert.equal(parseArgs(['--verify-only']).verifyOnly, true);
  });
  it('パスの逸脱・不明な引数・資格情報つきURLを拒む', () => {
    for (const args of [['--only', '../x'], ['--only'], ['--unknown'], ['--base-url', 'file:///x'],
      ['--base-url', 'http://user:secret@localhost'], ['--base-url', 'http://localhost/?key=x']]) {
      assert.throws(() => parseArgs(args));
    }
  });
  it('出力のリンクはブラウザ接続より前に拒む', async () => {
    const root = join(work, 'linked');
    mkdirSync(join(root, 'registry'), { recursive: true });
    symlinkSync(work, join(root, 'registry/previews'));
    await assert.rejects(makePreviews(root, parseArgs(['--verify-only'])), /Unsafe source path/);
  });
  it('同じ種で操作の乱数列が一致し、別の種では変わる', () => {
    const seq = (seed) => Array.from({ length: 100 }, seededRandom(seed));
    assert.deepEqual(seq(123), seq(123));
    assert.notDeepEqual(seq(123), seq(124));
  });
});

describe('動画の検査', () => {
  it('正しいメタデータと上下限ちょうどを受け入れる', () => {
    for (const duration of ['8', '10', '12']) {
      const probe = metadata(); probe.format.duration = duration;
      assert.deepEqual(inspectMetadata(probe, 1_000_000), []);
    }
  });
  it('解像度・fps・形式・音声・長さ・容量の違反をそれぞれ拒む', () => {
    const edits = [
      (p) => p.streams[0].width = 1280, (p) => p.streams[0].height = 720,
      (p) => p.streams[0].avg_frame_rate = '25/1', (p) => p.streams[0].codec_name = 'vp9',
      (p) => p.streams[0].pix_fmt = 'yuv444p', (p) => p.streams.push({ codec_type: 'audio' }),
      (p) => p.format.duration = '7.99', (p) => p.format.duration = '12.01',
      (p) => p.format.duration = 'NaN', (p) => p.streams = [],
    ];
    for (const edit of edits) {
      const probe = metadata(); edit(probe);
      assert.ok(inspectMetadata(probe, 5000).length > 0);
    }
    assert.ok(inspectMetadata(metadata(), 1_000_001).length > 0);
    assert.ok(inspectMetadata(metadata(), 0).length > 0);
  });
  it('先頭と3コマ後を比較し、静止・小さな雑音・不足したコマを拒む', () => {
    assert.equal(motionDifference(Buffer.alloc(640 * 360 * 4)).moving, false);
    const noise = Buffer.alloc(640 * 360 * 4);
    noise.fill(1, 640 * 360 * 3);
    assert.equal(motionDifference(noise).moving, false);
    noise.fill(40, 640 * 360 * 3, 640 * 360 * 3 + 1000);
    assert.equal(motionDifference(noise).moving, true);
    assert.throws(() => motionDifference(Buffer.alloc(10)), /先頭4コマ/);
  });
  it('活動率の境界0.6を守り、少ない変化と圧縮雑音を数えない', () => {
    const pixels = 100 * 100;
    const frames = Buffer.alloc(pixels * 11);
    for (let n = 1; n <= 10; n++) frames.fill(Math.min(n, 6) * 20, n * pixels, (n + 1) * pixels);
    assert.equal(activityRate(frames, 100, 100).activity, 0.6);
    assert.equal(activityRate(frames, 100, 100).activeEnough, true);
    frames.fill(100, 6 * pixels);
    assert.equal(activityRate(frames, 100, 100).activeEnough, false);
    const noise = Buffer.alloc(pixels * 4);
    noise.fill(1, pixels);
    assert.equal(activityRate(noise, 100, 100).activity, 0);
    assert.throws(() => activityRate(Buffer.alloc(1)), /必要なコマ/);
  });
  it('実際のffprobeとコマ抽出で、動くMP4を通し、静止MP4と音声つきを拒む', () => {
    const moving = 'testsrc2=size=640x360:rate=30';
    const checked = verifyPreview(make('moving', moving));
    assert.equal(checked.moving, true);
    assert.equal(checked.activeEnough, true);
    assert.throws(() => verifyPreview(make('static', 'color=c=black:size=640x360:rate=30')), /先頭が動いていません/);
    assert.throws(() => verifyPreview(make('audio', moving, true)), /音声の流れ/);
  });
  it('短い画面切替で先頭だけ動いても、ほぼ静止した動画は拒む', () => {
    const raw = join(work, 'brief-change.mp4');
    const edited = join(work, 'edited.mp4');
    const r = spawnSync('nice', ['-n', '10', process.env.IRORI_FFMPEG ?? '/opt/homebrew/bin/ffmpeg',
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
      "color=c=black:size=1280x720:rate=30,drawbox=x=100:y=100:w=300:h=300:color=white:t=fill:enable='between(t,1.63,1.73)'",
      '-t', '15', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-an', raw],
    { encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.throws(() => editPreview(raw, edited), /活動率が0.6未満/);
  });
});

describe('正式動画の安全な置き換え', () => {
  const setup = (name) => {
    const root = join(work, name);
    mkdirSync(join(root, 'registry/previews'), { recursive: true });
    mkdirSync(join(root, '.probe-tmp/previews'), { recursive: true });
    const output = join(root, 'registry/previews/lantern-market.mp4');
    const candidate = join(root, '.probe-tmp/previews/lantern-market.mp4');
    const previous = Buffer.from('退避する旧版');
    writeFileSync(output, previous);
    return { root, output, candidate, previous };
  };
  it('不合格候補では正式ファイルを変えず、候補も残す', () => {
    const { root, output, candidate, previous } = setup('rejected-replacement');
    copyFileSync(make('rejected', 'color=c=black:size=640x360:rate=30'), candidate);
    assert.throws(() => replacePreview(root, 'lantern-market'), /先頭が動いていません/);
    assert.deepEqual(readFileSync(output), previous);
    assert.deepEqual(readdirSync(join(root, '.probe-tmp/previews')), ['lantern-market.mp4']);
  });
  it('合格候補に置き換える前に、旧版を時刻つきで退避する', () => {
    const { root, output, candidate, previous } = setup('accepted-replacement');
    copyFileSync(make('accepted', 'testsrc2=size=640x360:rate=30'), candidate);
    const accepted = readFileSync(candidate);
    const { backup } = replacePreview(root, 'lantern-market');
    assert.match(backup, /_backup[/]lantern-market-\d{4}-.*\.mp4$/);
    assert.deepEqual(readFileSync(backup), previous);
    assert.deepEqual(readFileSync(output), accepted);
    assert.equal(readdirSync(join(root, '.probe-tmp/previews/_backup')).length, 1);
  });
});
