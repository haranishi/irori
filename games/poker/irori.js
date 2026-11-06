//#region ../protocol/src/limits.ts
var LIMITS = {
	MAX_PLAYERS: 8,
	CODE_ALPHABET: "23456789BCDFGHJKLMNPQRSTVWXYZ",
	CODE_LENGTH: 4,
	NAME_MAX_GRAPHEMES: 12,
	NAME_MAX_CODEPOINTS: 32,
	NAME_MAX_BYTES: 96,
	ID_MAX_LENGTH: 24,
	LABEL_MAX_GRAPHEMES: 12,
	HINT_MAX_GRAPHEMES: 40,
	TITLE_MAX_GRAPHEMES: 24,
	BODY_MAX_GRAPHEMES: 120,
	BUTTONS_MAX: 4,
	CHOICES_MIN: 2,
	CHOICES_MAX: 6,
	TILES_MAX: 20,
	TILES_SELECT_MAX: 8,
	FX_PATTERN_MAX: 8,
	FX_MS_MAX: 1e3,
	HELLO_TIMEOUT_MS: 5e3,
	PAD_GRACE_MS: 6e4,
	HOST_GRACE_MS: 9e4,
	ROOM_IDLE_MS: 12e5,
	ROOM_MAX_MS: 432e5,
	CREATE_TTL_S: 60,
	FRAME_MAX_BYTES: {
		pad: 512,
		host: 16384
	},
	RATE: {
		pad: {
			perSec: 60,
			burst: 120
		},
		host: {
			perSec: 40,
			burst: 80
		}
	},
	VIOLATIONS_BEFORE_CLOSE: 20,
	CREATE_PER_IP: {
		perMinute: 6,
		perHour: 60
	},
	LOOKUP_PER_IP: { perMinute: 30 },
	WS_CONNECT_PER_IP: { perMinute: 60 },
	IPV6_48_FACTOR: 4,
	ROOM_MAX_PENDING: 16,
	ROOM_NEW_SEATS_PER_MINUTE: 40,
	ROOM_LOCKS_PER_MINUTE: 20,
	DEFAULT_MAX_ROOMS_PER_DAY: 2e3,
	HOST_KEY_BYTES: 32,
	RESUME_TOKEN_BYTES: 16
};
var SEND_RATE_HZ = {
	axis: 20,
	ptr: 20,
	tilt: 15
};
var HELD_REPEAT_MS = 1e3;
//#endregion
//#region ../protocol/src/bridge.ts
var CUES = [
	"tick",
	"confirm",
	"deny",
	"turn",
	"win",
	"lose",
	"count",
	"go",
	"deal",
	"flip",
	"place",
	"sweep",
	"revolution",
	"roll",
	"pins",
	"strike",
	"spare",
	"gutter",
	"night",
	"dawn",
	"vote",
	"execute",
	"reveal"
];
var STORAGE_LIMITS = {
	KEY_MAX_LENGTH: 64,
	VALUE_MAX_BYTES: 16384,
	TOTAL_MAX_BYTES: 65536
};
//#endregion
//#region ../protocol/src/names.ts
var segmenter;
function segments(s) {
	segmenter ??= new Intl.Segmenter(void 0, { granularity: "grapheme" });
	return segmenter.segment(s);
}
function countGraphemes(s, stopAfter = Number.POSITIVE_INFINITY) {
	let n = 0;
	for (const _ of segments(s)) if (++n > stopAfter) break;
	return n;
}
function fitsGraphemes(s, max) {
	if (s.length <= max) return true;
	return countGraphemes(s, max) <= max;
}
function countCodePoints(s) {
	let n = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c >= 55296 && c <= 56319 && i + 1 < s.length) {
			const d = s.charCodeAt(i + 1);
			if (d >= 56320 && d <= 57343) i++;
		}
		n++;
	}
	return n;
}
function fitsCodePoints(s, max) {
	return s.length <= max || countCodePoints(s) <= max;
}
function utf8Length(s) {
	let n = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 128) n += 1;
		else if (c < 2048) n += 2;
		else if (c >= 55296 && c <= 56319 && i + 1 < s.length) {
			const d = s.charCodeAt(i + 1);
			if (d >= 56320 && d <= 57343) {
				n += 4;
				i++;
			} else n += 3;
		} else n += 3;
	}
	return n;
}
function truncateGraphemes(s, max) {
	if (s.length <= max) return s;
	let out = "";
	let n = 0;
	for (const { segment } of segments(s)) {
		if (n++ >= max) break;
		out += segment;
	}
	return out;
}
//#endregion
//#region ../protocol/src/end.ts
function plain(v) {
	if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}
var reject$1 = (reason) => ({
	ok: false,
	reason
});
function validateGameEnd(results, options) {
	const out = { ok: true };
	if (results !== void 0) {
		if (!Array.isArray(results) || results.length > LIMITS.MAX_PLAYERS) return reject$1("results-array");
		const rows = [];
		const seen = new Set();
		for (const row of results) {
			if (!plain(row) || Object.keys(row).some((k) => ![
				"p",
				"score",
				"label",
				"ranked"
			].includes(k))) return reject$1("result-shape");
			const { p, score, label, ranked } = row;
			if (!Number.isInteger(p) || p < 1 || p > LIMITS.MAX_PLAYERS || seen.has(p) || !Number.isFinite(score) || label !== void 0 && (typeof label !== "string" || !fitsGraphemes(label, LIMITS.LABEL_MAX_GRAPHEMES)) || ranked !== void 0 && typeof ranked !== "boolean") return reject$1("result-value");
			seen.add(p);
			const clean = {
				p,
				score
			};
			if (label !== void 0) clean.label = label;
			if (ranked !== void 0) clean.ranked = ranked;
			rows.push(clean);
		}
		out.results = rows;
	}
	if (options !== void 0) {
		if (!plain(options) || Object.keys(options).some((k) => ![
			"display",
			"outcome",
			"note"
		].includes(k))) return reject$1("options-shape");
		const { display, outcome, note } = options;
		if (display !== void 0 && display !== "points" && display !== "record" || outcome !== void 0 && outcome !== "complete" && outcome !== "incomplete" || note !== void 0 && (typeof note !== "string" || !fitsGraphemes(note, LIMITS.BODY_MAX_GRAPHEMES))) return reject$1("options-value");
		const clean = {};
		if (display !== void 0) clean.display = display;
		if (outcome !== void 0) clean.outcome = outcome;
		if (note !== void 0) clean.note = note;
		if (clean.display === "record" && out.results?.some((row) => row.label === void 0)) return reject$1("record-label");
		out.options = clean;
	}
	return out;
}
LIMITS.CODE_ALPHABET;
//#endregion
//#region ../protocol/src/validate.ts
var ID_RE$1 = new RegExp(`^[a-z0-9_-]{1,${LIMITS.ID_MAX_LENGTH}}$`);
var COLORS$2 = [
	"red",
	"blue",
	"green",
	"yellow",
	"gray"
];
var STICKS = [
	"none",
	"dpad",
	"stick"
];
var ORIENTS$1 = [
	"any",
	"landscape",
	"portrait"
];
var TOUCH_MODES = ["area", "swipe"];
var Reject = class {
	reason;
	constructor(reason) {
		this.reason = reason;
	}
};
function reject(reason) {
	throw new Reject(reason);
}
function attempt(fn) {
	try {
		return {
			ok: true,
			frame: fn()
		};
	} catch (e) {
		if (e instanceof Reject) return {
			ok: false,
			reason: e.reason
		};
		throw e;
	}
}
function obj(v, where) {
	if (typeof v !== "object" || v === null || Array.isArray(v)) reject(`${where}: object`);
	return v;
}
function onlyKeys(o, allowed, where) {
	for (const k of Object.keys(o)) if (!allowed.includes(k)) reject(`${where}: unknown key ${k.slice(0, 24)}`);
}
function text(v, max, where) {
	if (typeof v !== "string") reject(`${where}: string`);
	if (!fitsCodePoints(v, max)) reject(`${where}: longer than ${max}`);
	return v;
}
function ident(v, where) {
	if (typeof v !== "string" || !ID_RE$1.test(v)) reject(`${where}: id`);
	return v;
}
function bool(v, where) {
	if (typeof v !== "boolean") reject(`${where}: boolean`);
	return v;
}
function integer(v, lo, hi, where) {
	if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) reject(`${where}: integer ${lo}..${hi}`);
	return v;
}
function oneOf(v, values, where) {
	if (typeof v !== "string" || !values.includes(v)) reject(`${where}: one of ${values.join("|")}`);
	return v;
}
function labeled(v, where) {
	const o = obj(v, where);
	onlyKeys(o, [
		"id",
		"label",
		"color"
	], where);
	const out = {
		id: ident(o.id, `${where}.id`),
		label: text(o.label, LIMITS.LABEL_MAX_GRAPHEMES, `${where}.label`)
	};
	if (o.color !== void 0) out.color = oneOf(o.color, COLORS$2, `${where}.color`);
	return out;
}
function labeledList(v, min, max, where) {
	if (!Array.isArray(v)) reject(`${where}: array`);
	if (v.length < min || v.length > max) reject(`${where}: ${min}..${max} items`);
	return Array.from(v, (item, i) => labeled(item, `${where}[${i}]`));
}
function tileSpec(v, where) {
	const o = obj(v, where);
	onlyKeys(o, [
		"id",
		"label",
		"sub",
		"color",
		"off"
	], where);
	const t = {
		id: ident(o.id, `${where}.id`),
		label: text(o.label, LIMITS.LABEL_MAX_GRAPHEMES, `${where}.label`)
	};
	if (o.sub !== void 0) t.sub = text(o.sub, LIMITS.LABEL_MAX_GRAPHEMES, `${where}.sub`);
	if (o.color !== void 0) t.color = oneOf(o.color, COLORS$2, `${where}.color`);
	if (o.off !== void 0) t.off = bool(o.off, `${where}.off`);
	return t;
}
function hint$1(o, where) {
	return o.hint === void 0 ? void 0 : text(o.hint, LIMITS.HINT_MAX_GRAPHEMES, `${where}.hint`);
}
function padSpec(v, allowRemote, where) {
	const o = obj(v, where);
	switch (o.k) {
		case "wait": {
			onlyKeys(o, [
				"k",
				"title",
				"body"
			], where);
			const s = { k: "wait" };
			if (o.title !== void 0) s.title = text(o.title, LIMITS.TITLE_MAX_GRAPHEMES, `${where}.title`);
			if (o.body !== void 0) s.body = text(o.body, LIMITS.BODY_MAX_GRAPHEMES, `${where}.body`);
			return s;
		}
		case "pad": {
			onlyKeys(o, [
				"k",
				"stick",
				"buttons",
				"hint",
				"orient"
			], where);
			const s = { k: "pad" };
			if (o.stick !== void 0) s.stick = oneOf(o.stick, STICKS, `${where}.stick`);
			if (o.buttons !== void 0) s.buttons = labeledList(o.buttons, 0, LIMITS.BUTTONS_MAX, `${where}.buttons`);
			const h = hint$1(o, where);
			if (h !== void 0) s.hint = h;
			if (o.orient !== void 0) s.orient = oneOf(o.orient, ORIENTS$1, `${where}.orient`);
			return s;
		}
		case "buzzer": {
			onlyKeys(o, [
				"k",
				"label",
				"color",
				"disabled",
				"hint"
			], where);
			const s = {
				k: "buzzer",
				label: text(o.label, LIMITS.LABEL_MAX_GRAPHEMES, `${where}.label`)
			};
			if (o.color !== void 0) s.color = oneOf(o.color, COLORS$2, `${where}.color`);
			if (o.disabled !== void 0) s.disabled = bool(o.disabled, `${where}.disabled`);
			const h = hint$1(o, where);
			if (h !== void 0) s.hint = h;
			return s;
		}
		case "choices": {
			onlyKeys(o, [
				"k",
				"options",
				"disabled",
				"hint"
			], where);
			const s = {
				k: "choices",
				options: labeledList(o.options, LIMITS.CHOICES_MIN, LIMITS.CHOICES_MAX, `${where}.options`)
			};
			if (o.disabled !== void 0) s.disabled = bool(o.disabled, `${where}.disabled`);
			const h = hint$1(o, where);
			if (h !== void 0) s.hint = h;
			return s;
		}
		case "tiles": {
			onlyKeys(o, [
				"k",
				"tiles",
				"ok",
				"pass",
				"min",
				"max",
				"note",
				"hint",
				"disabled",
				"token"
			], where);
			if (!Array.isArray(o.tiles) || o.tiles.length > LIMITS.TILES_MAX) reject(`${where}.tiles: array of at most ${LIMITS.TILES_MAX}`);
			const tiles = Array.from(o.tiles, (t, i) => tileSpec(t, `${where}.tiles[${i}]`));
			if (new Set(tiles.map((t) => t.id)).size !== tiles.length) reject(`${where}.tiles: duplicate id`);
			const cap = Math.min(LIMITS.TILES_SELECT_MAX, tiles.filter((t) => t.off !== true).length);
			const s = {
				k: "tiles",
				tiles,
				ok: text(o.ok, LIMITS.LABEL_MAX_GRAPHEMES, `${where}.ok`)
			};
			const max = o.max === void 0 ? Math.min(1, cap) : integer(o.max, 0, cap, `${where}.max`);
			const min = o.min === void 0 ? Math.min(1, max) : integer(o.min, 0, max, `${where}.min`);
			if (o.pass !== void 0) s.pass = text(o.pass, LIMITS.LABEL_MAX_GRAPHEMES, `${where}.pass`);
			if (o.min !== void 0) s.min = min;
			if (o.max !== void 0) s.max = max;
			if (o.note !== void 0) s.note = text(o.note, LIMITS.BODY_MAX_GRAPHEMES, `${where}.note`);
			const h = hint$1(o, where);
			if (h !== void 0) s.hint = h;
			if (o.disabled !== void 0) s.disabled = bool(o.disabled, `${where}.disabled`);
			if (o.token !== void 0) s.token = ident(o.token, `${where}.token`);
			return s;
		}
		case "touch": {
			onlyKeys(o, [
				"k",
				"mode",
				"hint"
			], where);
			const s = { k: "touch" };
			if (o.mode !== void 0) s.mode = oneOf(o.mode, TOUCH_MODES, `${where}.mode`);
			const h = hint$1(o, where);
			if (h !== void 0) s.hint = h;
			return s;
		}
		case "tilt": {
			onlyKeys(o, [
				"k",
				"buttons",
				"hint"
			], where);
			const s = { k: "tilt" };
			if (o.buttons !== void 0) s.buttons = labeledList(o.buttons, 0, LIMITS.BUTTONS_MAX, `${where}.buttons`);
			const h = hint$1(o, where);
			if (h !== void 0) s.hint = h;
			return s;
		}
		case "remote": {
			if (!allowRemote) reject(`${where}.k: remote is console only`);
			onlyKeys(o, ["k", "hint"], where);
			const s = { k: "remote" };
			const h = hint$1(o, where);
			if (h !== void 0) s.hint = h;
			return s;
		}
		default: return reject(`${where}.k: unknown`);
	}
}
function validatePadSpec(value, allowRemote = false) {
	return attempt(() => padSpec(value, allowRemote, "spec"));
}
//#endregion
//#region ../pad-ui/src/dom.ts
function h$1(tag, attrs, ...children) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs ?? {})) if (v !== void 0) el.setAttribute(k, v);
	for (const c of children) if (c) el.append(typeof c === "string" ? document.createTextNode(c) : c);
	return el;
}
var SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs) {
	const el = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, String(v));
	return el;
}
//#endregion
//#region ../pad-ui/src/text.ts
function clip(text, max) {
	return typeof text === "string" ? truncateGraphemes(text, max) : "";
}
//#endregion
//#region ../pad-ui/src/throttle.ts
var Throttle = class {
	intervalMs;
	emit;
	same;
	repeat;
	last;
	lastAt = Number.NEGATIVE_INFINITY;
	pending;
	timer;
	repeatTimer;
	constructor(intervalMs, emit, same, initial, repeat) {
		this.intervalMs = intervalMs;
		this.emit = emit;
		this.same = same;
		this.repeat = repeat;
		this.last = initial;
	}
	push(value) {
		if (this.timer !== void 0) {
			this.pending = value;
			return;
		}
		if (this.last !== void 0 && this.same(value, this.last)) return;
		const wait = this.lastAt + this.intervalMs - performance.now();
		if (wait <= 0) {
			this.send(value);
			return;
		}
		this.pending = value;
		this.timer = setTimeout(() => this.flush(), Math.ceil(wait));
	}
	now(value) {
		this.cancel();
		this.send(value);
	}
	settle(value) {
		this.cancel();
		if (this.last === void 0 || !this.same(value, this.last)) this.send(value);
	}
	cancel() {
		if (this.timer !== void 0) clearTimeout(this.timer);
		this.timer = void 0;
		this.pending = void 0;
		this.stopRepeat();
	}
	flush() {
		this.timer = void 0;
		const value = this.pending;
		this.pending = void 0;
		if (value !== void 0 && (this.last === void 0 || !this.same(value, this.last))) this.send(value);
	}
	send(value) {
		this.last = value;
		this.lastAt = performance.now();
		this.emit(value);
		this.armRepeat(value);
	}
	stopRepeat() {
		if (this.repeatTimer !== void 0) clearTimeout(this.repeatTimer);
		this.repeatTimer = void 0;
	}
	armRepeat(sent) {
		this.stopRepeat();
		const next = this.repeat?.value(sent) ?? null;
		if (next === null || !this.repeat) return;
		this.repeatTimer = setTimeout(() => this.fireRepeat(next), this.repeat.ms);
	}
	fireRepeat(next) {
		this.repeatTimer = void 0;
		const wait = this.timer !== void 0 ? this.intervalMs : this.lastAt + this.intervalMs - performance.now();
		if (wait > 0) {
			this.repeatTimer = setTimeout(() => this.fireRepeat(next), Math.ceil(wait));
			return;
		}
		this.send(next);
	}
};
//#endregion
//#region ../pad-ui/src/pad.ts
var PAD_STRINGS_JA = {
	tilesLimit: "これ以上選べません",
	tilesSent: "送りました",
	waiting: "待っています",
	dpad: "十字キー",
	stick: "スティック",
	touch: "なぞる場所",
	up: "上",
	down: "下",
	left: "左",
	right: "右",
	ok: "決定",
	back: "戻る",
	tiltAsk: "スマホを傾けて操作します。センサーの使用を許可してください。",
	tiltAllow: "許可する",
	tiltDenied: "センサーが許可されませんでした。端末の設定を確かめてください。",
	tiltInsecure: "傾きのセンサーは、HTTPS の接続でだけ使えます。",
	tiltOn: "スマホを傾けて操作します"
};
var PAD_STRINGS_EN = {
	tilesLimit: "You cannot select any more",
	tilesSent: "Sent",
	waiting: "Waiting",
	dpad: "D-pad",
	stick: "Stick",
	touch: "Touch area",
	up: "Up",
	down: "Down",
	left: "Left",
	right: "Right",
	ok: "OK",
	back: "Back",
	tiltAsk: "Tilt your phone to play. Please allow the motion sensor.",
	tiltAllow: "Allow",
	tiltDenied: "The motion sensor was not allowed. Check your device settings.",
	tiltInsecure: "The motion sensor works only over HTTPS.",
	tiltOn: "Tilt your phone to play"
};
var AXIS_MS = 1e3 / SEND_RATE_HZ.axis;
var PTR_MS = 1e3 / SEND_RATE_HZ.ptr;
var TILT_MS = 1e3 / SEND_RATE_HZ.tilt;
var AXIS_REPEAT = {
	ms: HELD_REPEAT_MS,
	value: (v) => v.x !== 0 || v.y !== 0 ? v : null
};
var PTR_REPEAT = {
	ms: HELD_REPEAT_MS,
	value: (v) => v.ph === "e" ? null : {
		x: v.x,
		y: v.y,
		ph: "m"
	}
};
var STICK_DEAD = .1;
var DPAD_DEAD = .3;
var ID_RE = new RegExp(`^[a-z0-9_-]{1,${LIMITS.ID_MAX_LENGTH}}$`);
var COLORS$1 = [
	"red",
	"blue",
	"green",
	"yellow",
	"gray"
];
var ENDS = [
	"pointerup",
	"pointercancel",
	"lostpointercapture"
];
var NEUTRAL = {
	x: 0,
	y: 0
};
var r1 = (n) => Math.round(n * 10) / 10 || 0;
var r2$1 = (n) => Math.round(n * 100) / 100 || 0;
var r3 = (n) => Math.round(n * 1e3) / 1e3 || 0;
var clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
var sameXY = (a, b) => a.x === b.x && a.y === b.y;
function capture(el, pointerId) {
	try {
		el.setPointerCapture(pointerId);
	} catch {}
}
function colorOf(c) {
	return COLORS$1.includes(c) ? c : void 0;
}
function hint(text) {
	const s = clip(text, LIMITS.HINT_MAX_GRAPHEMES);
	return s ? h$1("p", { class: "irori-pad__hint" }, s) : null;
}
var Btn = class {
	id;
	out;
	el;
	held = new Set();
	dead = false;
	constructor(id, label, out, opt = {}) {
		this.id = id;
		this.out = out;
		this.el = h$1("button", {
			type: "button",
			class: `irori-pad__btn${opt.cls ? ` ${opt.cls}` : ""}`,
			"data-id": id,
			"data-color": opt.color,
			"aria-label": opt.aria ?? label
		}, label);
		if (opt.disabled) this.el.disabled = true;
		this.el.addEventListener("pointerdown", (e) => this.down(e));
		for (const t of ENDS) this.el.addEventListener(t, (e) => this.up(e));
		this.el.addEventListener("click", (e) => {
			if (e.detail !== 0 || this.dead || this.el.disabled || this.held.size > 0) return;
			this.out({
				k: "btn",
				id: this.id,
				d: 1
			});
			this.out({
				k: "btn",
				id: this.id,
				d: 0
			});
		});
	}
	down(e) {
		if (this.dead || this.el.disabled) return;
		capture(this.el, e.pointerId);
		if (this.held.has(e.pointerId)) return;
		this.held.add(e.pointerId);
		if (this.held.size === 1) {
			this.el.dataset.pressed = "";
			this.out({
				k: "btn",
				id: this.id,
				d: 1
			});
		}
	}
	up(e) {
		if (!this.held.delete(e.pointerId)) return;
		if (this.held.size === 0) this.finish();
	}
	finish() {
		delete this.el.dataset.pressed;
		this.out({
			k: "btn",
			id: this.id,
			d: 0
		});
	}
	release() {
		if (this.held.size === 0) return;
		this.held.clear();
		this.finish();
	}
	dispose() {
		this.dead = true;
		this.held.clear();
	}
};
var Choices = class {
	disabled;
	out;
	el;
	picked = false;
	dead = false;
	constructor(options, disabled, out) {
		this.disabled = disabled;
		this.out = out;
		this.el = h$1("div", {
			class: "irori-pad__choices",
			"data-count": String(options.length)
		});
		for (const o of options) {
			const label = clip(o.label, LIMITS.LABEL_MAX_GRAPHEMES);
			const el = h$1("button", {
				type: "button",
				class: "irori-pad__btn irori-pad__choice",
				"data-id": o.id,
				"data-color": colorOf(o.color),
				"aria-label": label
			}, label);
			if (disabled) el.disabled = true;
			el.addEventListener("pointerdown", () => this.pick(o.id, el));
			el.addEventListener("click", (e) => {
				if (e.detail === 0) this.pick(o.id, el);
			});
			this.el.append(el);
		}
	}
	pick(id, el) {
		if (this.dead || this.disabled || this.picked) return;
		this.picked = true;
		el.dataset.picked = "";
		el.setAttribute("aria-pressed", "true");
		this.el.dataset.picked = "";
		this.out({
			k: "pick",
			id
		});
	}
	release() {}
	dispose() {
		this.dead = true;
	}
};
var Surface = class {
	el;
	active = null;
	dead = false;
	constructor(el) {
		this.el = el;
		el.addEventListener("pointerdown", (e) => {
			if (this.dead || this.active !== null) return;
			this.active = e.pointerId;
			capture(el, e.pointerId);
			this.start(e);
		});
		el.addEventListener("pointermove", (e) => {
			if (!this.dead && e.pointerId === this.active) this.move(e);
		});
		for (const t of ENDS) el.addEventListener(t, (e) => {
			if (this.dead || e.pointerId !== this.active) return;
			this.active = null;
			this.end(e);
		});
	}
	rel(e) {
		const r = this.el.getBoundingClientRect();
		return {
			x: (e.clientX - r.left - r.width / 2) / (r.width / 2 || 1),
			y: (e.clientY - r.top - r.height / 2) / (r.height / 2 || 1)
		};
	}
	start(e) {
		this.move(e);
	}
	dispose() {
		this.dead = true;
		this.active = null;
	}
};
var DirPad = class extends Surface {
	arrows;
	t;
	constructor(out, s) {
		const arrow = (dir) => h$1("button", {
			type: "button",
			class: `irori-pad__arrow irori-pad__arrow--${dir}`,
			"aria-label": s[dir],
			tabindex: "-1"
		});
		const arrows = {
			up: arrow("up"),
			down: arrow("down"),
			left: arrow("left"),
			right: arrow("right")
		};
		super(h$1("div", {
			class: "irori-pad__dpad",
			role: "group",
			"aria-label": s.dpad
		}, arrows.up, arrows.left, arrows.right, arrows.down));
		this.arrows = arrows;
		this.t = new Throttle(AXIS_MS, (v) => out({
			k: "axis",
			id: "dpad",
			x: v.x,
			y: v.y
		}), sameXY, NEUTRAL, AXIS_REPEAT);
	}
	move(e) {
		const { x: dx, y: dy } = this.rel(e);
		let v = NEUTRAL;
		if (Math.hypot(dx, dy) >= DPAD_DEAD) {
			const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4;
			v = {
				x: Math.round(Math.cos(a)) || 0,
				y: Math.round(Math.sin(a)) || 0
			};
		}
		this.show(v);
		this.t.push(v);
	}
	end() {
		this.show(NEUTRAL);
		this.t.push(NEUTRAL);
	}
	show(v) {
		const on = {
			up: v.y < 0,
			down: v.y > 0,
			left: v.x < 0,
			right: v.x > 0
		};
		for (const k of [
			"up",
			"down",
			"left",
			"right"
		]) if (on[k]) this.arrows[k].dataset.pressed = "";
		else delete this.arrows[k].dataset.pressed;
	}
	release() {
		this.active = null;
		this.show(NEUTRAL);
		this.t.settle(NEUTRAL);
	}
	dispose() {
		super.dispose();
		this.t.cancel();
	}
};
var Stick = class extends Surface {
	knob;
	t;
	constructor(out, s) {
		const knob = h$1("div", { class: "irori-pad__knob" });
		super(h$1("div", {
			class: "irori-pad__stick",
			role: "group",
			"aria-label": s.stick
		}, knob));
		this.knob = knob;
		this.t = new Throttle(AXIS_MS, (v) => out({
			k: "axis",
			id: "stick",
			x: v.x,
			y: v.y
		}), sameXY, NEUTRAL, AXIS_REPEAT);
	}
	move(e) {
		let { x, y } = this.rel(e);
		const m = Math.hypot(x, y);
		if (m > 1) {
			x /= m;
			y /= m;
		}
		this.knob.style.transform = `translate(${r2$1(x * 64)}%, ${r2$1(y * 64)}%)`;
		this.t.push(m < STICK_DEAD ? NEUTRAL : {
			x: r2$1(x),
			y: r2$1(y)
		});
	}
	end() {
		this.knob.style.transform = "";
		this.t.push(NEUTRAL);
	}
	release() {
		this.active = null;
		this.knob.style.transform = "";
		this.t.settle(NEUTRAL);
	}
	dispose() {
		super.dispose();
		this.t.cancel();
	}
};
var TouchArea = class extends Surface {
	dot;
	t;
	last;
	constructor(out, s, mode) {
		const dot = h$1("div", { class: "irori-pad__dot" });
		super(h$1("div", {
			class: "irori-pad__touch",
			role: "group",
			"aria-label": s.touch,
			"data-mode": mode
		}, dot));
		this.dot = dot;
		this.last = {
			x: .5,
			y: .5
		};
		this.t = new Throttle(PTR_MS, (v) => out({
			k: "ptr",
			id: "touch",
			x: v.x,
			y: v.y,
			ph: v.ph
		}), (a, b) => a.ph === b.ph && a.x === b.x && a.y === b.y, void 0, PTR_REPEAT);
	}
	pos(e) {
		const { x, y } = this.rel(e);
		return {
			x: (x + 1) / 2,
			y: (y + 1) / 2
		};
	}
	start(e) {
		const p = this.pos(e);
		this.last = {
			x: r3(clamp(p.x, 0, 1)),
			y: r3(clamp(p.y, 0, 1))
		};
		this.showDot(this.last);
		this.t.now({
			...this.last,
			ph: "s"
		});
	}
	move(e) {
		const p = this.pos(e);
		const inside = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
		this.last = {
			x: r3(clamp(p.x, 0, 1)),
			y: r3(clamp(p.y, 0, 1))
		};
		if (!inside) {
			this.active = null;
			this.finish();
			return;
		}
		this.showDot(this.last);
		this.t.push({
			...this.last,
			ph: "m"
		});
	}
	end(e) {
		const p = this.pos(e);
		if (e.type === "pointerup") this.last = {
			x: r3(clamp(p.x, 0, 1)),
			y: r3(clamp(p.y, 0, 1))
		};
		this.finish();
	}
	finish() {
		delete this.dot.dataset.on;
		this.t.now({
			...this.last,
			ph: "e"
		});
	}
	showDot(p) {
		this.dot.dataset.on = "";
		this.dot.style.left = `${p.x * 100}%`;
		this.dot.style.top = `${p.y * 100}%`;
	}
	release() {
		if (this.active === null) return;
		this.active = null;
		this.finish();
	}
	dispose() {
		super.dispose();
		this.t.cancel();
	}
};
var Tiles = class {
	el;
	dead = false;
	timers = new Set();
	constructor(spec, out, s) {
		const selected = new Set();
		const max = spec.max ?? Math.min(1, spec.tiles.filter((t) => !t.off).length);
		const min = spec.min ?? Math.min(1, max);
		let sent = false;
		const status = h$1("p", {
			class: "irori-pad__status",
			role: "status",
			"aria-live": "polite",
			"aria-atomic": "true"
		});
		const grid = h$1("div", {
			class: "irori-pad__tiles-grid",
			tabindex: "0"
		});
		const ok = h$1("button", {
			type: "button",
			class: "irori-pad__btn",
			"data-action": "ok"
		}, spec.ok);
		const pass = h$1("button", {
			type: "button",
			class: "irori-pad__btn",
			"data-action": "pass"
		}, spec.pass ?? "");
		const actions = h$1("div", { class: "irori-pad__tiles-actions" }, ok, spec.pass === void 0 ? null : pass);
		const update = () => {
			ok.disabled = sent || selected.size < min || selected.size > max;
			ok.setAttribute("aria-disabled", String(ok.disabled));
			for (const b of grid.querySelectorAll("button")) {
				const on = selected.has(b.dataset.id);
				b.setAttribute("aria-pressed", String(on));
				if (sent) {
					b.disabled = true;
					b.setAttribute("aria-disabled", "true");
				}
			}
		};
		const submit = (passing) => {
			if (this.dead || sent || spec.disabled || !passing && ok.disabled) return;
			sent = true;
			this.el.dataset.sent = "";
			pass.disabled = true;
			pass.setAttribute("aria-disabled", "true");
			status.textContent = s.tilesSent;
			update();
			const token = spec.token === void 0 ? {} : { t: spec.token };
			out(passing ? {
				k: "tiles",
				ids: [],
				pass: true,
				...token
			} : {
				k: "tiles",
				ids: [...selected],
				...token
			});
		};
		for (const tile of spec.tiles) {
			const b = h$1("button", {
				type: "button",
				class: "irori-pad__btn irori-pad__tile",
				"data-id": tile.id,
				"aria-pressed": "false",
				"aria-disabled": String(!!spec.disabled || !!tile.off)
			}, h$1("span", { class: "irori-pad__tile-label" }, tile.label), tile.sub === void 0 ? null : h$1("small", {}, tile.sub), h$1("span", {
				class: "irori-pad__tile-check",
				"aria-hidden": "true"
			}, "✓"));
			if (tile.color) b.dataset.color = tile.color;
			b.disabled = !!spec.disabled || !!tile.off;
			b.addEventListener("click", () => {
				if (this.dead || sent || b.disabled) return;
				delete b.dataset.limit;
				if (selected.has(tile.id)) selected.delete(tile.id);
				else if (max === 1) {
					selected.clear();
					selected.add(tile.id);
				} else if (selected.size >= max) {
					status.textContent = "";
					status.append(document.createTextNode(s.tilesLimit));
					b.dataset.limit = "";
					const timer = setTimeout(() => {
						delete b.dataset.limit;
						this.timers.delete(timer);
					}, 300);
					this.timers.add(timer);
					return;
				} else selected.add(tile.id);
				status.textContent = "";
				update();
			});
			b.addEventListener("animationend", () => delete b.dataset.limit);
			grid.append(b);
		}
		ok.addEventListener("click", () => submit(false));
		pass.addEventListener("click", () => submit(true));
		this.el = h$1("div", { class: "irori-pad__tiles" }, spec.note === void 0 ? null : h$1("p", { class: "irori-pad__text" }, spec.note), grid, status, spec.disabled ? null : actions);
		update();
	}
	release() {}
	dispose() {
		this.dead = true;
		for (const timer of this.timers) clearTimeout(timer);
		this.timers.clear();
	}
};
var tiltGranted = false;
var Tilt = class {
	s;
	el;
	status;
	t;
	listening = false;
	dead = false;
	constructor(out, s) {
		this.s = s;
		this.status = h$1("p", {
			class: "irori-pad__status",
			role: "status"
		});
		this.el = h$1("div", { class: "irori-pad__tilt" }, this.status);
		this.t = new Throttle(TILT_MS, (v) => out({
			k: "tilt",
			a: v.a,
			b: v.b,
			g: v.g
		}), (p, q) => p.a === q.a && p.b === q.b && p.g === q.g);
		const api = globalThis.DeviceOrientationEvent;
		if (globalThis.isSecureContext === false) {
			this.listen();
			this.status.textContent = s.tiltInsecure;
		} else if (api && typeof api.requestPermission === "function" && !tiltGranted) {
			const ask = api.requestPermission.bind(api);
			const allow = h$1("button", {
				type: "button",
				class: "irori-pad__btn irori-pad__allow"
			}, s.tiltAllow);
			allow.addEventListener("click", () => {
				ask().then((state) => {
					if (state !== "granted") {
						this.status.textContent = s.tiltDenied;
						return;
					}
					tiltGranted = true;
					allow.remove();
					this.listen();
				}, () => {
					this.status.textContent = s.tiltDenied;
				});
			});
			this.status.textContent = s.tiltAsk;
			this.el.append(allow);
		} else this.listen();
	}
	onOrient = (e) => {
		const { alpha, beta, gamma } = e;
		if (alpha == null || beta == null || gamma == null) return;
		this.t.push({
			a: r1(clamp(alpha, 0, 360)),
			b: r1(clamp(beta, -180, 180)),
			g: r1(clamp(gamma, -90, 90))
		});
	};
	listen() {
		if (this.dead || this.listening) return;
		this.listening = true;
		this.status.textContent = this.s.tiltOn;
		this.el.dataset.on = "";
		globalThis.addEventListener("deviceorientation", this.onOrient);
	}
	release() {}
	dispose() {
		this.dead = true;
		this.t.cancel();
		if (this.listening) globalThis.removeEventListener("deviceorientation", this.onOrient);
	}
};
function buttons(list, out, controls) {
	const box = h$1("div", { class: "irori-pad__btns" });
	const seen = new Set();
	for (const b of Array.isArray(list) ? list : []) {
		if (seen.size >= LIMITS.BUTTONS_MAX) break;
		if (!b || typeof b.id !== "string" || !ID_RE.test(b.id) || seen.has(b.id)) continue;
		seen.add(b.id);
		const btn = new Btn(b.id, clip(b.label, LIMITS.LABEL_MAX_GRAPHEMES), out, { color: colorOf(b.color) });
		controls.push(btn);
		box.append(btn.el);
	}
	box.dataset.count = String(seen.size);
	return box;
}
function choices(list) {
	const out = [];
	const seen = new Set();
	for (const o of Array.isArray(list) ? list : []) {
		if (out.length >= LIMITS.CHOICES_MAX) break;
		if (!o || typeof o.id !== "string" || !ID_RE.test(o.id) || seen.has(o.id)) continue;
		seen.add(o.id);
		out.push(o);
	}
	return out;
}
function build(spec, out, s) {
	const controls = [];
	const view = (kind, ...nodes) => ({
		kind,
		nodes,
		controls
	});
	const body = (...nodes) => h$1("div", { class: "irori-pad__body" }, ...nodes);
	switch (spec?.k) {
		case "pad": {
			let dir = null;
			if (spec.stick !== "none") {
				const c = spec.stick === "stick" ? new Stick(out, s) : new DirPad(out, s);
				controls.push(c);
				dir = c.el;
			}
			return view("pad", hint(spec.hint), body(dir, buttons(spec.buttons, out, controls)));
		}
		case "buzzer": {
			const b = new Btn("buzzer", clip(spec.label, LIMITS.LABEL_MAX_GRAPHEMES), out, {
				color: colorOf(spec.color),
				disabled: spec.disabled === true,
				cls: "irori-pad__buzzer"
			});
			controls.push(b);
			return view("buzzer", hint(spec.hint), body(b.el));
		}
		case "choices": {
			const c = new Choices(choices(spec.options), spec.disabled === true, out);
			controls.push(c);
			return view("choices", hint(spec.hint), body(c.el));
		}
		case "tiles": {
			const tiles = new Tiles(spec, out, s);
			controls.push(tiles);
			return view("tiles", hint(spec.hint), tiles.el);
		}
		case "touch": {
			const t = new TouchArea(out, s, spec.mode === "swipe" ? "swipe" : "area");
			controls.push(t);
			return view("touch", hint(spec.hint), body(t.el));
		}
		case "tilt": {
			const t = new Tilt(out, s);
			controls.push(t);
			return view("tilt", hint(spec.hint), body(t.el, buttons(spec.buttons, out, controls)));
		}
		case "remote": {
			const mk = (id, cls) => {
				const b = new Btn(id, id === "ok" || id === "back" ? s[id] : "", out, {
					cls,
					aria: s[id]
				});
				controls.push(b);
				return b.el;
			};
			const cross = h$1("div", {
				class: "irori-pad__cross",
				role: "group",
				"aria-label": s.dpad
			}, mk("up", "irori-pad__arrow irori-pad__arrow--up"), mk("left", "irori-pad__arrow irori-pad__arrow--left"), mk("right", "irori-pad__arrow irori-pad__arrow--right"), mk("down", "irori-pad__arrow irori-pad__arrow--down"));
			const keys = h$1("div", { class: "irori-pad__btns irori-pad__keys" }, mk("ok", "irori-pad__ok"), mk("back", "irori-pad__back"));
			return view("remote", hint(spec.hint), body(cross, keys));
		}
		case "wait": return view("wait", waiting(spec.title, spec.body, s));
		default: return view("wait", waiting(void 0, void 0, s));
	}
}
function waiting(titleRaw, bodyRaw, s) {
	const text = clip(bodyRaw, LIMITS.BODY_MAX_GRAPHEMES);
	const title = clip(titleRaw, LIMITS.TITLE_MAX_GRAPHEMES) || (text ? "" : s.waiting);
	return h$1("div", {
		class: "irori-pad__wait",
		role: "status"
	}, title ? h$1("p", { class: "irori-pad__title" }, title) : null, text ? h$1("p", { class: "irori-pad__text" }, text) : null);
}
var ORIENTS = [
	"any",
	"landscape",
	"portrait"
];
function mountPad(container, options) {
	const strings = {
		...PAD_STRINGS_JA,
		...options.strings
	};
	const root = h$1("div", {
		class: "irori-pad",
		"data-kind": "wait"
	});
	for (const t of [
		"contextmenu",
		"selectstart",
		"dblclick",
		"dragstart"
	]) root.addEventListener(t, (e) => e.preventDefault());
	container.append(root);
	let controls = [];
	let destroyed = false;
	const out = (input) => options.send(input);
	const releaseHeld = (_why) => {
		for (const c of controls) c.release();
	};
	const setSpec = (spec) => {
		if (destroyed) return;
		releaseHeld("setSpec");
		for (const c of controls) c.dispose();
		const v = build(spec, out, strings);
		controls = v.controls;
		root.dataset.kind = v.kind;
		const orient = spec.orient;
		if (v.kind === "pad") root.dataset.orient = ORIENTS.includes(orient) ? orient : "any";
		else delete root.dataset.orient;
		root.replaceChildren(...v.nodes.filter((n) => n !== null));
	};
	setSpec({ k: "wait" });
	return {
		setSpec,
		releaseAll: () => {
			if (!destroyed) releaseHeld("releaseAll");
		},
		destroy: () => {
			if (destroyed) return;
			releaseHeld("destroy");
			for (const c of controls) c.dispose();
			controls = [];
			destroyed = true;
			root.remove();
		}
	};
}
//#endregion
//#region ../pad-ui/src/look.ts
var SHAPES = [
	"circle",
	"square",
	"triangle",
	"diamond",
	"star",
	"cross",
	"hexagon",
	"ring"
];
var COLORS = [
	"#E69F00",
	"#56B4E9",
	"#009E73",
	"#F0E442",
	"#0072B2",
	"#D55E00",
	"#CC79A7",
	"#EDEDED"
];
var NAMES = {
	ja: {
		colors: [
			"橙",
			"空色",
			"緑",
			"黄色",
			"青",
			"朱色",
			"桃色",
			"白"
		],
		shapes: [
			"丸",
			"四角",
			"三角",
			"ひし形",
			"星",
			"十字",
			"六角形",
			"輪"
		],
		join: (c, s) => `${c}の${s}`
	},
	en: {
		colors: [
			"orange",
			"sky blue",
			"green",
			"yellow",
			"blue",
			"vermilion",
			"pink",
			"white"
		],
		shapes: [
			"circle",
			"square",
			"triangle",
			"diamond",
			"star",
			"cross",
			"hexagon",
			"ring"
		],
		join: (c, s) => `${c} ${s}`
	}
};
var r2 = (n) => Math.round(n * 100) / 100;
function polygon(points) {
	return `M${points.map(([x, y]) => `${r2(x)} ${r2(y)}`).join("L")}Z`;
}
function around(cx, cy, radii, count, startDeg) {
	const pts = [];
	for (let i = 0; i < count; i++) {
		const a = (startDeg + 360 / count * i) * Math.PI / 180;
		const r = radii[i % radii.length] ?? 0;
		pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
	}
	return pts;
}
var PATHS = {
	circle: "M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20Z",
	square: "M3 3h18v18H3Z",
	triangle: "M12 1L22.4 19H1.6Z",
	diamond: "M12 1L23 12L12 23L1 12Z",
	star: polygon(around(12, 12.6, [11.5, 4.6], 10, -90)),
	cross: "M8 2h8v6h6v8h-6v6H8v-6H2V8h6Z",
	hexagon: polygon(around(12, 12, [11], 6, 0)),
	ring: "M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20ZM12 6.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11Z"
};
function look(id, locale = "ja") {
	if (!Number.isInteger(id) || id < 1 || id > LIMITS.MAX_PLAYERS) throw new RangeError(`席番号は1〜${LIMITS.MAX_PLAYERS}の整数です（受け取った値: ${String(id)}）`);
	const i = id - 1;
	const names = NAMES[locale] ?? NAMES.ja;
	const shape = SHAPES[i];
	return {
		color: COLORS[i],
		shape,
		label: names.join(names.colors[i], names.shapes[i]),
		path: PATHS[shape]
	};
}
function shapeSvg(shape, size, color) {
	const d = PATHS[shape];
	if (!d) throw new RangeError(`知らない形です: ${String(shape)}`);
	const el = svg("svg", {
		viewBox: "0 0 24 24",
		width: size,
		height: size,
		class: "irori-shape",
		"data-shape": shape,
		"aria-hidden": "true",
		focusable: "false"
	});
	el.append(svg("path", {
		d,
		fill: color,
		stroke: "rgba(0,0,0,0.45)",
		"stroke-width": .75,
		"stroke-linejoin": "round"
	}));
	return el;
}
//#endregion
//#region src/checks.ts
function checkPadSpec(spec) {
	const r = validatePadSpec(spec, false);
	return r.ok ? null : r.reason;
}
function isSeat(v) {
	return Number.isInteger(v) && v >= 1 && v <= LIMITS.MAX_PLAYERS;
}
function checkVibrate(ms) {
	const list = typeof ms === "number" ? [ms] : Array.isArray(ms) ? ms : null;
	if (!list || list.length === 0 || list.length > LIMITS.FX_PATTERN_MAX) return `振動は1〜${LIMITS.FX_PATTERN_MAX}個の数です`;
	const out = [];
	for (const n of list) {
		if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > LIMITS.FX_MS_MAX) return `振動の長さは0〜${LIMITS.FX_MS_MAX}ミリ秒です`;
		out.push(Math.round(n));
	}
	return out;
}
function readEnv(v) {
	if (!plain(v) || Object.keys(v).length !== 2 || typeof v.connected !== "boolean" || typeof v.visible !== "boolean") return null;
	return Object.freeze({
		connected: v.connected,
		visible: v.visible
	});
}
function isStoreKey(v) {
	return typeof v === "string" && v.length >= 1 && v.length <= STORAGE_LIMITS.KEY_MAX_LENGTH;
}
function isStoreValue(v) {
	return typeof v === "string" && v.length <= STORAGE_LIMITS.VALUE_MAX_BYTES && utf8Length(v) <= STORAGE_LIMITS.VALUE_MAX_BYTES;
}
//#endregion
//#region src/errors.ts
var IroriError = class extends Error {
	code;
	constructor(code, message) {
		super(message ? `${code}: ${message}` : code);
		this.name = "IroriError";
		this.code = code;
	}
};
//#endregion
//#region src/core.ts
var STORAGE_TIMEOUT_MS = 5e3;
var CAPS = [
	"result-options-v1",
	"host-environment-v1",
	"pad-tiles-v1",
	"cue-v1"
];
function report(err) {
	if (typeof reportError === "function") reportError(err);
	else console.error(err);
}
function freezePlayers(list) {
	const out = [];
	for (const p of Array.isArray(list) ? list : []) if (plain(p) && isSeat(p.id) && typeof p.name === "string") out.push(Object.freeze({
		id: p.id,
		name: p.name,
		online: p.online !== false
	}));
	return Object.freeze(out.slice(0, LIMITS.MAX_PLAYERS));
}
var IroriCore = class {
	mode;
	t;
	locale;
	storage;
	caps;
	env;
	list;
	leaderId;
	isPaused;
	readied = false;
	ended = false;
	nextId = 1;
	cueTimes = [];
	lastCue = new Map();
	waiting = new Map();
	listeners = new Map();
	constructor(mode, init, t, locale = init.locale) {
		this.mode = mode;
		this.t = t;
		this.locale = locale;
		this.list = freezePlayers(init.players);
		this.leaderId = init.leader;
		this.isPaused = init.paused;
		this.caps = Object.freeze(CAPS.filter((c) => Array.isArray(init.capabilities) && init.capabilities.includes(c)));
		this.env = this.caps.includes("host-environment-v1") ? readEnv(init.environment) : null;
		this.storage = {
			get: (key) => this.request("get", key),
			set: (key, value) => this.request("set", key, value).then(() => void 0)
		};
	}
	get players() {
		return this.list;
	}
	get leader() {
		return this.leaderId;
	}
	get paused() {
		return this.isPaused;
	}
	get environment() {
		return this.env;
	}
	get capabilities() {
		return this.caps;
	}
	on(name, fn) {
		let set = this.listeners.get(name);
		if (!set) {
			set = new Set();
			this.listeners.set(name, set);
		}
		set.add(fn);
		return () => {
			set.delete(fn);
		};
	}
	setPad(spec, to = "all") {
		const dest = this.target(to);
		const bad = checkPadSpec(spec);
		if (bad) throw new IroriError("bad-pad", bad);
		if (spec.k === "tiles" && !this.caps.includes("pad-tiles-v1")) throw new IroriError("unsupported-feature");
		this.t.send({
			m: "setPad",
			to: dest,
			spec
		});
	}
	vibrate(ms, to = "all") {
		const dest = this.target(to);
		const list = checkVibrate(ms);
		if (typeof list === "string") throw new IroriError("bad-vibrate", list);
		this.t.send({
			m: "vibrate",
			to: dest,
			ms: list
		});
	}
	cue(name, v = .7) {
		if (this.mode === "mock" || !this.caps.includes("cue-v1") || !CUES.includes(name) || typeof v !== "number" || Number.isNaN(v)) return;
		const now = performance.now();
		this.cueTimes = this.cueTimes.filter((t) => now - t < 1e3);
		if (now - (this.lastCue.get(name) ?? -Infinity) < 50 || this.cueTimes.length >= 20) return;
		this.lastCue.set(name, now);
		this.cueTimes.push(now);
		this.t.send({
			m: "cue",
			name,
			v: Math.max(0, Math.min(1, v))
		});
	}
	look(id) {
		return look(id, this.locale.toLowerCase().startsWith("ja") ? "ja" : "en");
	}
	ready() {
		if (this.readied) return;
		this.readied = true;
		this.t.send({ m: "ready" });
	}
	end(results, options) {
		if (this.ended) return;
		const r = validateGameEnd(results, options);
		if (!r.ok) throw new IroriError("bad-results", r.reason);
		if ((r.options !== void 0 || r.results?.some((row) => row.ranked !== void 0)) && !this.caps.includes("result-options-v1")) throw new IroriError("unsupported-feature");
		const { ok: _, ...data } = r;
		this.ended = true;
		this.t.send({
			m: "end",
			...data
		});
	}
	receive(msg) {
		if (!plain(msg)) return;
		switch (msg.m) {
			case "players":
				this.list = freezePlayers(msg.players);
				this.leaderId = isSeat(msg.leader) ? msg.leader : null;
				this.emit("players", this.list, this.leaderId);
				return;
			case "input": {
				const i = msg.i;
				if (!isSeat(msg.p) || !plain(i) || i.k === "menu") return;
				this.emit("input", msg.p, i, typeof msg.T === "number" ? msg.T : Date.now());
				return;
			}
			case "pause":
			case "resume": {
				const paused = msg.m === "pause";
				if (paused === this.isPaused) return;
				this.isPaused = paused;
				this.emit(msg.m);
				return;
			}
			case "environment": {
				if (!this.caps.includes("host-environment-v1") || Object.keys(msg).length !== 2) return;
				const next = readEnv(msg.environment);
				if (!next || next.connected === this.env?.connected && next.visible === this.env?.visible) return;
				this.env = next;
				this.emit("environment", next);
				return;
			}
			case "store.res": {
				const w = typeof msg.id === "number" ? this.waiting.get(msg.id) : void 0;
				if (!w) return;
				this.waiting.delete(msg.id);
				clearTimeout(w.timer);
				if (typeof msg.error === "string") w.reject(new IroriError(storageCode(msg.error), msg.error));
				else w.resolve(typeof msg.value === "string" ? msg.value : null);
				return;
			}
		}
	}
	target(to) {
		if (to === "all") return "*";
		if (isSeat(to)) return to;
		throw new IroriError("bad-target", `宛先は席番号（1〜${LIMITS.MAX_PLAYERS}）か 'all' です`);
	}
	request(op, key, value) {
		if (!isStoreKey(key)) return Promise.reject(new IroriError("storage-key", "鍵は1〜64文字の文字列です"));
		if (op === "set" && !isStoreValue(value)) return Promise.reject(new IroriError("storage-too-large", "値は16KBまでの文字列です"));
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiting.delete(id);
				reject(new IroriError("storage-timeout"));
			}, STORAGE_TIMEOUT_MS);
			this.waiting.set(id, {
				resolve,
				reject,
				timer
			});
			this.t.send(op === "get" ? {
				m: "store.get",
				id,
				key
			} : {
				m: "store.set",
				id,
				key,
				value
			});
		});
	}
	emit(name, ...args) {
		for (const fn of [...this.listeners.get(name) ?? []]) try {
			fn(...args);
		} catch (err) {
			report(err);
		}
	}
};
function storageCode(error) {
	if (error === "quota") return "storage-quota";
	if (error === "too-large") return "storage-too-large";
	if (error === "key") return "storage-key";
	return "storage-unavailable";
}
//#endregion
//#region src/host.ts
var HELLO_RETRY_MS = 250;
function connectHost(win, timeoutMs) {
	return new Promise((resolve, reject) => {
		const parent = win.parent;
		const hello = {
			irori: "hello",
			v: 1
		};
		let port = null;
		let core = null;
		const say = () => {
			try {
				parent.postMessage(hello, "*");
			} catch {}
		};
		const retry = setInterval(say, HELLO_RETRY_MS);
		const timer = setTimeout(() => {
			finish();
			port?.close();
			reject(new IroriError("handshake-timeout", `${timeoutMs}ミリ秒以内にコンソールと握手できませんでした`));
		}, timeoutMs);
		const finish = () => {
			clearInterval(retry);
			clearTimeout(timer);
			win.removeEventListener("message", onWindow);
		};
		const onPort = (e) => {
			const m = e.data;
			if (core) {
				core.receive(m);
				return;
			}
			if (!plain(m) || m.m !== "init" || !port) return;
			const p = port;
			core = new IroriCore("host", {
				players: Array.isArray(m.players) ? m.players : [],
				leader: typeof m.leader === "number" ? m.leader : null,
				paused: m.paused === true,
				locale: typeof m.locale === "string" ? m.locale : "ja",
				capabilities: m.capabilities,
				environment: m.environment
			}, { send: (msg) => p.postMessage(msg) });
			finish();
			resolve(core);
		};
		const onWindow = (ev) => {
			if (ev.source !== parent || port) return;
			const d = ev.data;
			if (!plain(d) || d.irori !== "port" || d.v !== 1 || ev.ports.length !== 1) return;
			port = ev.ports[0];
			clearInterval(retry);
			port.onmessage = onPort;
		};
		win.addEventListener("message", onWindow);
		say();
	});
}
//#endregion
//#region ../pad-ui/src/pad.css?inline
var pad_default = ".irori-pad{--pad-red:#9e3329;--pad-blue:#285a99;--pad-green:#24653f;--pad-yellow:#e8c547;--pad-gray:#5b4f47;--pad-ink:var(--bg,#1a1411);--pad-edge:var(--text-dim,#c9b8a6);--pad-face:var(--bg-card,#2f241d);--pad-on:var(--glow,#ffd9a0);--pad-size:clamp(144px, 40cqi, 240px);box-sizing:border-box;width:100%;height:100%;min-height:220px;color:var(--text,#f5ebe0);font-family:var(--font,ui-rounded, system-ui, sans-serif);overscroll-behavior:contain;touch-action:none;-webkit-tap-highlight-color:transparent;flex-direction:column;gap:12px;padding:12px;font-size:16px;line-height:1.4;display:flex;position:relative;container-type:inline-size}.irori-pad,.irori-pad *{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:none}.irori-pad *,.irori-pad :before{box-sizing:border-box}.irori-pad__hint{text-align:center;color:var(--pad-edge);margin:0}.irori-pad__body{flex:1;justify-content:center;align-items:center;gap:16px;min-height:0;display:flex}.irori-pad[data-kind=pad] .irori-pad__body,.irori-pad[data-kind=tilt] .irori-pad__body,.irori-pad[data-kind=remote] .irori-pad__body{justify-content:space-between;align-items:flex-end;padding-bottom:8px}.irori-pad__btn,.irori-pad__arrow{appearance:none;border:2px solid var(--pad-edge);background:var(--pad-face);min-width:48px;min-height:48px;color:var(--text,#f5ebe0);font:inherit;cursor:pointer;border-radius:14px;margin:0;padding:8px 14px;font-size:18px;font-weight:700;line-height:1.2;transition:transform .12s,background-color .12s}.irori-pad__btn[data-color=red]{background:var(--pad-red)}.irori-pad__btn[data-color=blue]{background:var(--pad-blue)}.irori-pad__btn[data-color=green]{background:var(--pad-green)}.irori-pad__btn[data-color=yellow]{background:var(--pad-yellow);color:var(--pad-ink)}.irori-pad__btn[data-color=gray]{background:var(--pad-gray)}.irori-pad__btn[data-pressed],.irori-pad__arrow[data-pressed],.irori-pad__choice[data-picked]{background:var(--pad-on);border-color:var(--pad-on);color:var(--pad-ink);transform:scale(.96)}.irori-pad__btn:disabled{opacity:.45;cursor:default}.irori-pad__btn:focus-visible,.irori-pad__arrow:focus-visible,.irori-pad__tiles-grid:focus-visible{outline:3px solid var(--pad-on);outline-offset:2px}.irori-pad__btns{flex:none;grid-template-columns:repeat(2,minmax(64px,1fr));gap:12px;display:grid}.irori-pad__btns[data-count=\"0\"]{display:none}.irori-pad__btns[data-count=\"1\"]{grid-template-columns:minmax(88px,1fr)}.irori-pad__btns .irori-pad__btn{min-width:max(64px,18cqi);min-height:max(64px,15cqi)}.irori-pad__dpad,.irori-pad__cross{width:var(--pad-size);aspect-ratio:1;flex:none;grid-template:repeat(3,1fr)/repeat(3,1fr);gap:4px;display:grid}.irori-pad__arrow{border-radius:12px;padding:0}.irori-pad__arrow--up{grid-area:1/2}.irori-pad__arrow--left{grid-area:2/1}.irori-pad__arrow--right{grid-area:2/3}.irori-pad__arrow--down{grid-area:3/2}.irori-pad__arrow:before{content:\"\";aspect-ratio:1;clip-path:polygon(50% 12%,92% 82%,8% 82%);background:currentColor;width:42%;margin:auto;display:block}.irori-pad__arrow--down:before{transform:rotate(180deg)}.irori-pad__arrow--left:before{transform:rotate(-90deg)}.irori-pad__arrow--right:before{transform:rotate(90deg)}.irori-pad__stick{width:var(--pad-size);aspect-ratio:1;border:2px solid var(--pad-edge);background:radial-gradient(circle, var(--pad-face) 55%, var(--line,#4a382c));border-radius:50%;flex:none;position:relative}.irori-pad__knob{background:var(--pad-edge);pointer-events:none;border-radius:50%;width:44%;height:44%;position:absolute;top:28%;left:28%}.irori-pad__buzzer{aspect-ratio:1;border-width:4px;border-radius:50%;width:clamp(160px,70cqi,320px);font-size:28px}.irori-pad__choices{grid-template-columns:repeat(2,1fr);gap:12px;width:100%;display:grid}.irori-pad__choices[data-count=\"3\"]{grid-template-columns:1fr}.irori-pad__choice{min-height:72px;font-size:20px}.irori-pad__choices[data-picked] .irori-pad__choice:not([data-picked]){opacity:.45}.irori-pad__touch{border:2px dashed var(--pad-edge);background:var(--pad-face);border-radius:14px;width:100%;height:100%;min-height:160px;position:relative;overflow:hidden}.irori-pad__dot{background:var(--pad-on);opacity:0;pointer-events:none;border-radius:50%;width:56px;height:56px;margin:-28px 0 0 -28px;position:absolute;top:50%;left:50%}.irori-pad__dot[data-on]{opacity:.85}.irori-pad__tilt{text-align:center;flex-direction:column;align-items:center;gap:12px;display:flex}.irori-pad__status{max-width:28em;color:var(--pad-edge);margin:0}.irori-pad__allow{min-height:56px}.irori-pad__wait{text-align:center;flex-direction:column;flex:1;justify-content:center;align-items:center;gap:8px;display:flex}.irori-pad__title{margin:0;font-size:24px;font-weight:700}.irori-pad__text{max-width:32em;color:var(--pad-edge);white-space:pre-line;margin:0}.irori-pad__keys{grid-template-columns:1fr}.irori-pad__ok{min-width:120px;min-height:72px}@media (prefers-reduced-motion:reduce){.irori-pad__btn,.irori-pad__arrow{transition:none}.irori-pad__btn[data-pressed],.irori-pad__arrow[data-pressed],.irori-pad__choice[data-picked]{transform:none}}.irori-pad[data-kind=tiles]{touch-action:pan-y;min-height:0;overflow:hidden}.irori-pad__tiles{touch-action:pan-y;flex-direction:column;flex:1;gap:8px;min-height:0;display:flex}.irori-pad__tiles-grid{overscroll-behavior:contain;flex:1;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:minmax(72px,max-content);align-content:start;gap:8px;min-height:0;padding:4px;display:grid;overflow-y:auto}.irori-pad__tiles-grid,.irori-pad__tiles-grid *{touch-action:pan-y}.irori-pad__tile{overflow-wrap:anywhere;min-width:56px;min-height:56px;padding:8px 4px 20px;position:relative}.irori-pad__tile:disabled{opacity:.68}.irori-pad__tile-label,.irori-pad__tile small{display:block}.irori-pad__tile small{font-size:16px}.irori-pad__tile-check{visibility:hidden;position:absolute;bottom:0;right:5px}.irori-pad__tile[aria-pressed=true]{box-shadow:inset 0 0 0 2px var(--pad-on);border-width:4px}.irori-pad__tile[aria-pressed=true] .irori-pad__tile-check{visibility:visible}.irori-pad__tile[data-limit]{outline:3px solid var(--pad-on);outline-offset:-3px;animation:.2s irori-tiles-limit}.irori-pad__tiles-actions{flex:none;gap:8px;display:flex}.irori-pad__tiles-actions button{overflow-wrap:anywhere;flex:1;min-width:0}.irori-pad__tiles .irori-pad__text{overflow-wrap:anywhere;max-width:none}.irori-pad__tiles .irori-pad__status{min-height:1.4em;font-size:16px}.irori-pad__tiles[data-sent] .irori-pad__status{color:var(--pad-on);font-weight:700}@container (width>=480px){.irori-pad__tiles-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}@container (width>=640px){.irori-pad__tiles-grid{grid-template-columns:repeat(5,minmax(0,1fr))}}@keyframes irori-tiles-limit{50%{transform:translate(3px)}}@media (prefers-reduced-motion:reduce){.irori-pad__tile[data-limit]{animation:none}}";
//#endregion
//#region src/mock.css?inline
var mock_default = ".irori-mock{--m-bg:#1a1411;--m-card:#2f241d;--m-line:#4a382c;--m-text:#f5ebe0;--m-dim:#c9b8a6;--m-glow:#ffd9a0;color:var(--m-text);font:14px/1.4 ui-rounded,system-ui,sans-serif}.irori-mock__btn{border:1px solid var(--m-dim);background:var(--m-card);min-height:32px;color:var(--m-text);font:inherit;cursor:pointer;border-radius:8px;padding:4px 10px}.irori-mock__btn:focus-visible{outline:3px solid var(--m-glow);outline-offset:2px}.irori-mock__banner{z-index:2147483000;border:1px solid var(--m-line);background:#1a1411eb;border-radius:999px;align-items:center;gap:8px;padding:3px 4px 3px 12px;font-size:13px;display:flex;position:fixed;top:6px;left:50%;transform:translate(-50%)}.irori-mock__panel{z-index:2147483000;border-left:1px solid var(--m-line);background:#1a1411f5;width:min(320px,92vw);max-height:100vh;position:fixed;top:0;right:0;overflow:auto;box-shadow:-4px 0 16px #0006}.irori-mock__panel[data-folded]{width:auto}.irori-mock__panel[data-folded]>:not(.irori-mock__head){display:none}.irori-mock__head{z-index:1;background:var(--m-bg);align-items:center;gap:6px;padding:8px;display:flex;position:sticky;top:0}.irori-mock__head h2{flex:1;margin:0;font-size:14px}.irori-mock__keys{color:var(--m-dim);margin:0 8px 8px;font-size:12px}.irori-mock__seat{border:2px solid var(--seat,var(--m-line));background:var(--m-bg);border-radius:12px;margin:8px}.irori-mock__seat[data-offline]{opacity:.5}.irori-mock__seat[data-buzz]{animation:.1s linear infinite irori-mock-buzz}@keyframes irori-mock-buzz{50%{transform:translate(2px)}}.irori-mock__who{align-items:center;gap:6px;padding:6px 8px;display:flex}.irori-mock__name{flex:1;font-weight:700}.irori-mock__pad{height:190px}.irori-mock__pad .irori-pad{--pad-size:clamp(96px, 38cqi, 136px);gap:8px;min-height:0;padding:8px}.irori-mock__pad .irori-pad__btns .irori-pad__btn{min-width:56px;min-height:48px}.irori-mock__pad .irori-pad__buzzer{width:120px}.irori-mock__pad .irori-pad__touch{min-height:0}.irori-mock__pad .irori-pad__choice{min-height:48px;font-size:16px}.irori-mock__pad [data-cursor]{outline:3px solid var(--m-glow);outline-offset:2px}.irori-mock__results{z-index:2147483001;background:#0009;place-items:center;display:grid;position:fixed;inset:0}.irori-mock__card{border:1px solid var(--m-dim);background:var(--m-card);border-radius:14px;min-width:min(360px,90vw);padding:20px}.irori-mock__card h2{margin:0 0 12px;font-size:20px}.irori-mock__card ol{gap:6px;margin:0 0 16px;padding:0;list-style:none;display:grid}.irori-mock__card li{align-items:center;gap:8px;font-size:16px;display:flex}.irori-mock__rank{min-width:2em;font-weight:700}.irori-mock__score{font-variant-numeric:tabular-nums;margin-left:auto}.irori-mock__again{border-color:var(--m-glow);background:var(--m-glow);min-height:44px;color:var(--m-bg);padding:8px 20px;font-weight:700}@media (prefers-reduced-motion:reduce){.irori-mock__seat[data-buzz]{outline:2px solid var(--m-glow);animation:none}}.irori-mock__pad:has([data-kind=tiles]){height:380px}";
//#endregion
//#region src/mock.ts
var TEXT = {
	ja: {
		banner: "開発モード（仮想プレイヤー）",
		close: "閉じる",
		title: "仮想プレイヤー",
		fold: "たたむ",
		unfold: "ひらく",
		pause: "一時停止",
		resume: "再開",
		drop: "切断する",
		join: "つなぐ",
		keys: "1人目: WASD・Space・E　2人目: 矢印・Enter・Shift。札: 席をクリック、矢印・Spaceで選択・Enterで決定・Pでパス",
		results: "結果",
		incomplete: "勝敗なし",
		again: "もう一度",
		player: (n) => `プレイヤー${n}`
	},
	en: {
		banner: "Development mode (virtual players)",
		close: "Close",
		title: "Virtual players",
		fold: "Fold",
		unfold: "Open",
		pause: "Pause",
		resume: "Resume",
		drop: "Disconnect",
		join: "Connect",
		keys: "P1: WASD, Space, E — P2: arrows, Enter, Shift. Tiles: click a seat, arrows, Space to select, Enter to submit, P to pass",
		results: "Results",
		incomplete: "No contest",
		again: "Play again",
		player: (n) => `Player ${n}`
	}
};
var KEYS = {
	KeyW: [0, "up"],
	KeyS: [0, "down"],
	KeyA: [0, "left"],
	KeyD: [0, "right"],
	Space: [0, "a"],
	KeyE: [0, "b"],
	ArrowUp: [1, "up"],
	ArrowDown: [1, "down"],
	ArrowLeft: [1, "left"],
	ArrowRight: [1, "right"],
	Enter: [1, "a"],
	NumpadEnter: [1, "a"],
	ShiftLeft: [1, "b"],
	ShiftRight: [1, "b"]
};
var TILT_DEG = 30;
function h(tag, attrs, ...kids) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, v);
	for (const c of kids) if (c !== null) el.append(c);
	return el;
}
function mockPlayerCount(search, fallback) {
	const q = new URLSearchParams(search).get("mock");
	const n = q === null ? NaN : Number.parseInt(q, 10);
	const v = Number.isFinite(n) ? n : fallback ?? 2;
	return Math.min(LIMITS.MAX_PLAYERS, Math.max(1, Math.trunc(v) || 1));
}
function createMock(win, opts = {}) {
	const doc = win.document;
	const locale = (win.navigator?.language ?? "ja").toLowerCase().startsWith("ja") ? "ja" : "en";
	const tx = TEXT[locale];
	const count = mockPlayerCount(win.location.search, opts.mockPlayers);
	const seats = [];
	const infos = Array.from({ length: count }, (_, i) => ({
		id: i + 1,
		name: tx.player(i + 1),
		online: true
	}));
	const env = () => ({
		connected: true,
		visible: doc.visibilityState === "visible"
	});
	const input = (p, i) => core.receive({
		m: "input",
		p,
		i,
		T: Date.now()
	});
	const leader = () => seats.find((s) => s.info.online)?.info.id ?? null;
	const targets = (to) => seats.filter((s) => to === "*" || s.info.id === to);
	const style = doc.createElement("style");
	style.textContent = pad_default + mock_default;
	(doc.head ?? doc.documentElement).append(style);
	const root = h("div", {
		class: "irori-mock",
		lang: locale
	});
	const close = h("button", {
		type: "button",
		class: "irori-mock__btn",
		"aria-label": tx.close
	}, "×");
	const banner = h("div", {
		class: "irori-mock__banner",
		role: "status"
	}, h("span", null, tx.banner), close);
	close.addEventListener("click", () => banner.remove());
	const pause = h("button", {
		type: "button",
		class: "irori-mock__btn irori-mock__pause"
	}, tx.pause);
	const fold = h("button", {
		type: "button",
		class: "irori-mock__btn irori-mock__fold",
		"aria-expanded": "true"
	}, tx.fold);
	const panel = h("aside", {
		class: "irori-mock__panel",
		"aria-label": tx.title
	}, h("div", { class: "irori-mock__head" }, h("h2", null, tx.title), pause, fold), h("p", { class: "irori-mock__keys" }, tx.keys));
	fold.addEventListener("click", () => {
		const folded = panel.toggleAttribute("data-folded");
		fold.textContent = folded ? tx.unfold : tx.fold;
		fold.setAttribute("aria-expanded", String(!folded));
	});
	pause.addEventListener("click", () => {
		core.receive({ m: core.paused ? "resume" : "pause" });
		pause.textContent = core.paused ? tx.resume : tx.pause;
	});
	root.append(banner, panel);
	const holdRepeat = (s) => {
		if (s.repeat !== void 0) clearTimeout(s.repeat);
		s.repeat = void 0;
		const a = s.aim;
		if (!a || a.k !== "axis" || a.x === 0 && a.y === 0) return;
		s.repeat = setTimeout(() => {
			s.repeat = void 0;
			if (s.aim !== a) return;
			input(s.info.id, {
				k: "axis",
				id: a.id,
				x: a.x,
				y: a.y
			});
			holdRepeat(s);
		}, HELD_REPEAT_MS);
	};
	const releaseKeys = (s) => {
		for (const id of s.held.values()) input(s.info.id, {
			k: "btn",
			id,
			d: 0
		});
		s.held.clear();
		if (s.aim && (s.aim.x !== 0 || s.aim.y !== 0)) input(s.info.id, s.aim.k === "axis" ? {
			k: "axis",
			id: s.aim.id,
			x: 0,
			y: 0
		} : {
			k: "tilt",
			a: 0,
			b: 0,
			g: 0
		});
		s.aim = null;
		holdRepeat(s);
		s.dirs.clear();
	};
	const steer = (s) => {
		const x = (s.dirs.has("right") ? 1 : 0) - (s.dirs.has("left") ? 1 : 0);
		const y = (s.dirs.has("down") ? 1 : 0) - (s.dirs.has("up") ? 1 : 0);
		const spec = s.spec;
		let next = null;
		if (spec.k === "pad" && spec.stick !== "none") {
			const id = spec.stick === "stick" ? "stick" : "dpad";
			const n = id === "stick" && x !== 0 && y !== 0 ? Math.round(Math.SQRT1_2 * 100) / 100 : 1;
			next = {
				k: "axis",
				id,
				x: x * n || 0,
				y: y * n || 0
			};
		} else if (spec.k === "tilt") next = {
			k: "tilt",
			id: "tilt",
			x: x * TILT_DEG,
			y: y * TILT_DEG
		};
		else return;
		const prev = s.aim ?? {
			x: 0,
			y: 0
		};
		if (prev.x === next.x && prev.y === next.y) return;
		s.aim = next;
		input(s.info.id, next.k === "axis" ? {
			k: "axis",
			id: next.id,
			x: next.x,
			y: next.y
		} : {
			k: "tilt",
			a: 0,
			b: next.y,
			g: next.x
		});
		holdRepeat(s);
	};
	const markCursor = (s) => {
		for (const el of s.box.querySelectorAll("[data-cursor]")) el.removeAttribute("data-cursor");
		if (s.spec.k !== "choices" && s.spec.k !== "tiles") return;
		const id = (s.spec.k === "tiles" ? s.spec.tiles : s.spec.options)[s.cursor]?.id;
		if (id) s.box.querySelector(`[data-id="${id}"]`)?.setAttribute("data-cursor", "");
	};
	const press = (s, key) => {
		const spec = s.spec;
		if (spec.k === "choices") {
			const o = spec.options[s.cursor];
			if (key === "a" && o && !spec.disabled && !s.picked) {
				s.picked = true;
				input(s.info.id, {
					k: "pick",
					id: o.id
				});
			}
			return;
		}
		let id;
		if (spec.k === "pad" || spec.k === "tilt") id = spec.buttons?.[key === "a" ? 0 : 1]?.id;
		else if (spec.k === "buzzer" && !spec.disabled) id = "buzzer";
		if (!id || s.held.has(key)) return;
		s.held.set(key, id);
		input(s.info.id, {
			k: "btn",
			id,
			d: 1
		});
	};
	const release = (s, key) => {
		const id = s.held.get(key);
		if (id === void 0) return;
		s.held.delete(key);
		input(s.info.id, {
			k: "btn",
			id,
			d: 0
		});
	};
	const onKey = (e) => {
		const hit = KEYS[e.code];
		if (e.type === "keyup" && hit) {
			const s = seats[hit[0]];
			const key = hit[1];
			if (s && (key === "a" || key === "b" ? s.held.has(key) : s.dirs.has(key))) {
				e.preventDefault();
				if (key === "a" || key === "b") release(s, key);
				else {
					s.dirs.delete(key);
					steer(s);
				}
				return;
			}
		}
		const target = e.target;
		if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
		if (target?.closest?.(".irori-mock__btn")) return;
		const tileSeat = seats.find((s) => target instanceof Node && s.card.contains(target)) ?? seats.find((s) => s.spec.k === "tiles" && s.info.online);
		if (tileSeat?.spec.k === "tiles" && [
			"ArrowUp",
			"ArrowDown",
			"ArrowLeft",
			"ArrowRight",
			"Space",
			"Enter",
			"NumpadEnter",
			"KeyP"
		].includes(e.code)) {
			e.preventDefault();
			if (e.type !== "keydown" || e.repeat || !tileSeat.info.online) return;
			const buttons = [...tileSeat.box.querySelectorAll(".irori-pad__tile")];
			const active = buttons.indexOf(doc.activeElement);
			if (active >= 0) tileSeat.cursor = active;
			if (e.code.startsWith("Arrow")) {
				if (buttons.length === 0) return;
				const step = e.code === "ArrowLeft" || e.code === "ArrowUp" ? -1 : 1;
				for (let n = 0; n < buttons.length; n++) {
					tileSeat.cursor = (tileSeat.cursor + step + buttons.length) % buttons.length;
					if (!buttons[tileSeat.cursor]?.disabled) break;
				}
				markCursor(tileSeat);
				buttons[tileSeat.cursor]?.focus();
			} else if (e.code === "Space") buttons[tileSeat.cursor]?.click();
			else tileSeat.box.querySelector(`[data-action="${e.code === "KeyP" ? "pass" : "ok"}"]`)?.click();
			return;
		}
		if (!hit) return;
		const t = e.target;
		if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		const s = seats[hit[0]];
		if (!s || !s.info.online) return;
		e.preventDefault();
		const key = hit[1];
		const down = e.type === "keydown";
		if (key === "a" || key === "b") {
			if (!down) release(s, key);
			else if (!e.repeat) press(s, key);
			return;
		}
		if (down) {
			if (e.repeat) return;
			s.dirs.add(key);
			if (s.spec.k === "choices") {
				const n = s.spec.options.length;
				s.cursor = (s.cursor + (key === "up" || key === "left" ? n - 1 : 1)) % n;
				markCursor(s);
			}
		} else s.dirs.delete(key);
		steer(s);
	};
	win.addEventListener("keydown", onKey);
	win.addEventListener("keyup", onKey);
	win.addEventListener("blur", () => seats.forEach(releaseKeys));
	const buzz = (s, ms) => {
		s.card.dataset.buzz = "";
		setTimeout(() => delete s.card.dataset.buzz, Math.min(1e3, ms.reduce((a, b) => a + b, 0)));
	};
	const prefix = `irori-mock:${win.location.pathname}:`;
	const store = (msg) => {
		const res = (value, error) => error ? {
			m: "store.res",
			id: msg.id,
			value,
			error
		} : {
			m: "store.res",
			id: msg.id,
			value
		};
		try {
			const ls = win.localStorage;
			if (msg.m === "store.get") return res(ls.getItem(prefix + msg.key));
			let total = 0;
			for (let i = 0; i < ls.length; i++) {
				const k = ls.key(i);
				if (k?.startsWith(prefix)) total += utf8Length(k.slice(prefix.length)) + utf8Length(ls.getItem(k) ?? "");
			}
			const old = ls.getItem(prefix + msg.key);
			const before = old === null ? 0 : utf8Length(msg.key) + utf8Length(old);
			if (total - before + utf8Length(msg.key) + utf8Length(msg.value) > STORAGE_LIMITS.TOTAL_MAX_BYTES) return res(null, "quota");
			ls.setItem(prefix + msg.key, msg.value);
			return res(null);
		} catch {
			return res(null, "unavailable");
		}
	};
	const showResults = (results, options = {}) => {
		root.querySelector(".irori-mock__results")?.remove();
		const ranked = (r) => options.outcome !== "incomplete" && r.ranked !== false;
		const sorted = [...results].sort((a, b) => Number(ranked(b)) - Number(ranked(a)) || (ranked(a) ? b.score - a.score : 0) || a.p - b.p);
		const list = h("ol", null);
		sorted.forEach((r) => {
			const rank = ranked(r) ? sorted.findIndex((o) => o.score === r.score) + 1 : null;
			const l = look(r.p, locale);
			const name = seats.find((s) => s.info.id === r.p)?.info.name ?? tx.player(r.p);
			list.append(h("li", {
				"data-p": String(r.p),
				"data-rank": String(rank ?? "")
			}, h("span", { class: "irori-mock__rank" }, String(rank ?? "—")), shapeSvg(l.shape, 20, l.color), h("span", null, name), h("span", { class: "irori-mock__score" }, options.display === "record" ? r.label ?? "" : r.label ? `${r.score}（${r.label}）` : String(r.score))));
		});
		const again = h("button", {
			type: "button",
			class: "irori-mock__btn irori-mock__again"
		}, tx.again);
		again.addEventListener("click", () => win.location.reload());
		root.append(h("div", {
			class: "irori-mock__results",
			role: "dialog",
			"aria-modal": "true",
			"aria-label": tx.results
		}, h("div", { class: "irori-mock__card" }, h("h2", null, options.outcome === "incomplete" ? tx.incomplete : tx.results), list, options.note === void 0 ? null : h("p", null, options.note), again)));
		again.focus();
	};
	const core = new IroriCore("mock", {
		players: infos,
		leader: 1,
		paused: false,
		locale,
		capabilities: CAPS,
		environment: env()
	}, { send(msg) {
		switch (msg.m) {
			case "setPad":
				for (const s of targets(msg.to)) {
					releaseKeys(s);
					s.spec = msg.spec;
					s.cursor = 0;
					s.picked = false;
					s.pad.setSpec(msg.spec);
					markCursor(s);
				}
				return;
			case "vibrate":
				for (const s of targets(msg.to)) buzz(s, msg.ms);
				return;
			case "end":
				showResults(msg.results ?? [], msg.options);
				return;
			case "cue": return;
			case "ready":
				root.dataset.ready = "";
				return;
			default: {
				const answer = store(msg);
				queueMicrotask(() => core.receive(answer));
			}
		}
	} });
	doc.addEventListener("visibilitychange", () => core.receive({
		m: "environment",
		environment: env()
	}));
	for (const info of infos) {
		const l = look(info.id, locale);
		const box = h("div", { class: "irori-mock__pad" });
		const toggle = h("button", {
			type: "button",
			class: "irori-mock__btn irori-mock__online"
		}, tx.drop);
		const card = h("section", {
			class: "irori-mock__seat",
			tabindex: "0",
			"data-p": String(info.id),
			"aria-label": `${info.name}（${l.label}）`
		}, h("div", { class: "irori-mock__who" }, shapeSvg(l.shape, 20, l.color), h("span", { class: "irori-mock__name" }, info.name), toggle), box);
		card.style.setProperty("--seat", l.color);
		const seat = {
			info,
			spec: { k: "wait" },
			pad: mountPad(box, {
				send: (i) => {
					if (seat.info.online) input(info.id, i);
				},
				strings: locale === "ja" ? PAD_STRINGS_JA : PAD_STRINGS_EN
			}),
			card,
			box,
			dirs: new Set(),
			held: new Map(),
			aim: null,
			repeat: void 0,
			cursor: 0,
			picked: false
		};
		toggle.addEventListener("click", () => {
			releaseKeys(seat);
			seat.pad.releaseAll();
			seat.info = {
				...seat.info,
				online: !seat.info.online
			};
			card.toggleAttribute("data-offline", !seat.info.online);
			toggle.textContent = seat.info.online ? tx.drop : tx.join;
			core.receive({
				m: "players",
				players: seats.map((s) => s.info),
				leader: leader()
			});
		});
		seats.push(seat);
		panel.append(card);
	}
	(doc.body ?? doc.documentElement).append(root);
	return core;
}
//#endregion
//#region src/index.ts
var HANDSHAKE_TIMEOUT_MS = 3e3;
var pending = null;
function connect(options = {}) {
	if (pending) return pending;
	const p = window.parent !== window ? connectHost(window, options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS) : Promise.resolve(createMock(window, { mockPlayers: options.mockPlayers }));
	pending = p;
	p.catch(() => {
		if (pending === p) pending = null;
	});
	return p;
}
//#endregion
export { IroriError, connect };
