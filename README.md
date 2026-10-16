# irori

**Gather around one screen. Phones are the controllers.** irori is an open-source web game console: open it on a big screen (a laptop on a TV works), scan the QR code with phones, and play. No installs, no accounts. Anyone can add a game with one pull request. This is a **first alpha**.

[![CI](https://github.com/haranishi/irori/actions/workflows/ci.yml/badge.svg)](https://github.com/haranishi/irori/actions/workflows/ci.yml)

> **日本語:** [README.ja.md](README.ja.md). The design documents are written in Japanese first; English translations are welcome (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## Try it in 3 minutes

```
git clone https://github.com/haranishi/irori
cd irori
npm install
npm run dev
```

Open the printed URL on the big screen, join the same Wi-Fi with a phone, scan the QR code on the screen, and tap "Join". Four sample games are included: `hello-pad`, `tap-race`, `quiz-4`, `dot-grab`. Node 24 or later is required.

Games that use the phone's tilt sensor need HTTPS on the phone side. See [docs/operate.md](docs/operate.md).

## What it is built around

1. **Zero setup.** The goal: from opening the host screen to the first game in 15 seconds.
2. **Game makers don't write networking.** The SDK is one file and nine calls.
3. **Operable by one person.** It runs on your own Wi-Fi or on Cloudflare, with caps on rooms, connections, messages and daily room count, so the bill cannot run away.
4. **Neither games nor phones are trusted.** Games run in a sandboxed iframe; every frame is validated.
5. **Only the experience pattern is borrowed.** Look, sound and wording are original, and no code or assets were taken from any reference.

The reasoning, and the things deliberately left out (accounts, analytics, ads, payments, uploads, chat), are in [docs/philosophy.md](docs/philosophy.md).

## Status

| Area | State |
|---|---|
| Join by QR or 4-character code, up to 8 seats, reconnect within 60 seconds | Alpha |
| Six controller kinds (pad, buzzer, choices, touch, tilt, wait) | Alpha |
| Sandboxed games, registry by pull request, CI checks | Alpha |
| Sharing (X, LINE, share sheet, copy link) and OGP | Alpha |
| Four sample games (`hello-pad`, `tap-race`, `quiz-4`, `dot-grab`), every way of ending them is tested | Alpha |
| Long sessions on real iPhones and Android phones, TV browsers | Not tested yet. Reports are very welcome. Automated tests run Chromium and WebKit (Safari's engine, via Playwright) only |
| Opening the host screen at phone width | Not officially supported (it does not break, but its visual score is around the pass line) |
| Problems found by playing (overlapping hints with 8 players, results of players who left, ...) | Listed in [docs/known-issues.md](docs/known-issues.md) (Japanese). Reports and fixes are welcome |
| Passing the console's mute setting on to games' sound | Not yet. The sample games make no sound |
| WebRTC for lower latency | Planned after measuring ([ADR 0002](docs/decisions/0002-websocket-first.md)) |
| Accounts, ranking, chat, payments, ads, analytics, game uploads | Not planned |

"Alpha" means the automated tests pass (unit and integration tests, end-to-end tests in real browsers, and mutation tests that break a safeguard on purpose and check that a test turns red; counts are in the CI output). Nobody has used it for long yet. No public demo is deployed. The UI is Japanese and English; the sample games' text is Japanese only.

## How it works

```mermaid
flowchart LR
  P["Phone /pad"] <-->|WebSocket| R["Durable Object<br/>room"]
  H["Host screen /"] <-->|WebSocket| R
  H --- G["Game<br/>sandboxed iframe + SDK"]
```

The host keeps the game state. The server only carries inputs and screen instructions. See [docs/architecture.md](docs/architecture.md) and [docs/protocol.md](docs/protocol.md) (Japanese).

## Add a game

Start from the short example (a 3-line HTML page and a 12-line script) in [docs/sdk.md](docs/sdk.md), then add `registry/games/<id>.json` and open a pull request. Review criteria are in [docs/registry.md](docs/registry.md).

## Contributing

Real-device reports, new games and translations are the most useful. There is one maintainer; expect a reply within about a week. Start with [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## Built with AI

Design and implementation were done together with an AI assistant (Claude) under human direction. Tests, independent read-only reviews and rights checks were run on the AI-written parts. Records are in [`.agent-harness/`](.agent-harness/).

## License

Code: MIT OR Apache-2.0. Documents and images: CC BY 4.0. Configuration and registry data: CC0 ([details](docs/legal/license-policy.md)). The legal judgments here have not been reviewed by a lawyer. Trademarks belong to their owners ("QR Code" is a registered trademark of DENSO WAVE INCORPORATED).
