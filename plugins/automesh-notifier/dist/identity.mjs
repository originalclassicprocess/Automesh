//#region node_modules/@noble/curves/node_modules/@noble/hashes/_u64.js
var e = (e) => e / 2 ** 32 | 0, t = (e) => e >>> 0;
function n(n, r, i, a) {
	let o = e(i), s = t(i);
	n.setUint32(r, a ? s : o, a), n.setUint32(r + 4, a ? o : s, a);
}
//#endregion
//#region node_modules/@noble/curves/node_modules/@noble/hashes/utils.js
function r(e) {
	return e instanceof Uint8Array || ArrayBuffer.isView(e) && e.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in e && e.BYTES_PER_ELEMENT === 1;
}
var i = (e) => e ? `"${e}" ` : "";
function a(e, t = "") {
	if (typeof e != "number") throw TypeError(i(t) + "expected number, got " + typeof e);
	if (!Number.isSafeInteger(e) || e < 0) throw RangeError(i(t) + "expected integer >= 0, got " + e);
	return e;
}
function o(e, t, n = "") {
	if (r(e) && (t === void 0 || e.length === t)) return e;
	t !== void 0 && a(t, "length");
	let o = r(e), s = t === void 0 ? "" : ` of length ${t}`, c = o ? `length=${e.length}` : `type=${typeof e}`, l = i(n) + "expected Uint8Array" + s + ", got " + c;
	throw o ? RangeError(l) : TypeError(l);
}
function s(e) {
	if (typeof e != "function" || typeof e.create != "function") throw TypeError("expected hash wrapped by utils.createHasher");
	if (a(e.outputLen), a(e.blockLen), e.outputLen < 1 || e.blockLen < 1) throw Error("hash blockLen / outputLen must be >= 1");
}
var c = (e, t) => {
	if (typeof e != "object" || !e || Array.isArray(e)) throw TypeError((t === "object" ? "" : `"${t}" `) + "expected object, got type=" + typeof e);
}, l = (e, t) => {
	c(e, t);
	let n = Object.getPrototypeOf(e);
	if (n !== Object.prototype && n !== null) throw TypeError(`"${t}" expected plain object`);
	if (Object.hasOwn(e, "__proto__")) throw TypeError(`"${t}.__proto__" is not allowed`);
};
function u(e, t = !0) {
	if (e.destroyed) throw Error("hash was destroyed");
	if (t && e.finished) throw Error("digest() was already called");
}
function d(e, t) {
	o(e, void 0, "output");
	let n = t.outputLen;
	if (!(e.length >= n)) throw RangeError("\"output\" expected length >= " + n);
}
function f(...e) {
	for (let t = 0; t < e.length; t++) e[t].fill(0);
}
function p(e) {
	return new DataView(e.buffer, e.byteOffset, e.byteLength);
}
function m(e, t) {
	return e << 32 - t | e >>> t;
}
var h = typeof Uint8Array.from([]).toHex == "function" && typeof Uint8Array.fromHex == "function", g = /* @__PURE__ */ Array.from({ length: 256 }, (e, t) => t.toString(16).padStart(2, "0"));
function _(e) {
	if (o(e), h) return e.toHex();
	let t = "";
	for (let n = 0; n < e.length; n++) t += g[e[n]];
	return t;
}
function v(e) {
	return e >= 48 && e <= 57 ? e - 48 : e >= 65 && e <= 70 ? e - 55 : e >= 97 && e <= 102 ? e - 87 : void 0;
}
function y(e) {
	if (typeof e != "string") throw TypeError("hex string expected, got " + typeof e);
	if (h) try {
		return Uint8Array.fromHex(e);
	} catch (e) {
		throw e instanceof SyntaxError ? RangeError(e.message) : e;
	}
	let t = e.length, n = t / 2;
	if (t % 2) throw RangeError("hex string expected, got unpadded hex of length " + t);
	let r = new Uint8Array(n);
	for (let t = 0, i = 0; t < n; t++, i += 2) {
		let n = v(e.charCodeAt(i)), a = v(e.charCodeAt(i + 1));
		if (n === void 0 || a === void 0) {
			let t = e[i] + e[i + 1];
			throw RangeError("hex string expected, got non-hex character \"" + t + "\" at index " + i);
		}
		r[t] = n * 16 + a;
	}
	return r;
}
function ee(...e) {
	let t = 0;
	for (let n = 0; n < e.length; n++) {
		let r = e[n];
		o(r), t += r.length;
	}
	let n = new Uint8Array(t);
	for (let t = 0, r = 0; t < e.length; t++) {
		let i = e[t];
		n.set(i, r), r += i.length;
	}
	return n;
}
function te(e, t, n = "opts") {
	return l(e, "defaults"), t !== void 0 && l(t, n), Object.assign(Object.create(null), e, t);
}
function b(e, t = {}) {
	if (typeof e != "function") throw TypeError("\"hashCons\" expected function, got type=" + typeof e);
	t = te({}, t, "info");
	let n = (t, n) => e(n).update(t).digest(), r = e(void 0);
	return n.outputLen = r.outputLen, n.blockLen = r.blockLen, n.canXOF = r.canXOF, n.create = (t) => e(t), Object.assign(n, t), Object.freeze(n);
}
function x(e = 32) {
	a(e, "bytesLength");
	let t = typeof globalThis == "object" ? globalThis.crypto : null;
	if (typeof t?.getRandomValues != "function") throw Error("crypto.getRandomValues must be defined");
	if (e > 65536) throw RangeError(`"bytesLength" expected <= 65536, got ${e}`);
	return t.getRandomValues(new Uint8Array(e));
}
var S = (e) => ({ oid: Uint8Array.from([
	6,
	9,
	96,
	134,
	72,
	1,
	101,
	3,
	4,
	2,
	e
]) });
//#endregion
//#region node_modules/@noble/curves/node_modules/@noble/hashes/_md.js
function C(e, t, n) {
	return e & t ^ ~e & n;
}
function ne(e, t, n) {
	return e & t ^ e & n ^ t & n;
}
var w = class {
	blockLen;
	outputLen;
	canXOF = !1;
	padOffset;
	isLE;
	buffer;
	view;
	finished = !1;
	length = 0;
	pos = 0;
	destroyed = !1;
	constructor(e, t, n, r) {
		this.blockLen = e, this.outputLen = t, this.padOffset = n, this.isLE = r, this.buffer = new Uint8Array(e), this.view = p(this.buffer);
	}
	update(e) {
		u(this), o(e);
		let { view: t, buffer: n, blockLen: r } = this, i = e.length, a = !1;
		for (let o = 0; o < i;) {
			let s = Math.min(r - this.pos, i - o);
			if (s === r) {
				let t = p(e);
				for (; r <= i - o; o += r) this.process(t, o);
				a = !0;
				continue;
			}
			n.set(o === 0 && s === i ? e : e.subarray(o, o + s), this.pos), this.pos += s, o += s, this.pos === r && (this.process(t, 0), this.pos = 0, a = !0);
		}
		return this.length += e.length, a && this.roundClean(), this;
	}
	digestInto(e) {
		u(this), d(e, this), this.finished = !0;
		let { buffer: t, view: r, blockLen: i, isLE: a } = this, { pos: o } = this;
		t[o++] = 128, t.fill(0, o), this.padOffset > i - o && (this.process(r, 0), t.fill(0)), n(r, i - 8, this.length * 8, a), this.process(r, 0), this.roundClean();
		let s = e === t ? r : p(e), c = this.outputLen, l = c / 4, f = this.get();
		if (c % 4 || l > f.length) throw Error("invalid outputLen");
		for (let e = 0; e < l; e++) s.setUint32(4 * e, f[e], a);
	}
	digest() {
		let { buffer: e, outputLen: t } = this;
		this.digestInto(e);
		let n = e.slice(0, t);
		return this.destroy(), n;
	}
	_cloneIntoMeta(e) {
		let { buffer: t, length: n, finished: r, destroyed: i, pos: a } = this;
		return e.destroyed = i, e.finished = r, e.length = n, e.pos = a, a && e.buffer.set(t), e;
	}
	clone() {
		return this._cloneInto();
	}
}, T = /* @__PURE__ */ Uint32Array.from([
	1779033703,
	3144134277,
	1013904242,
	2773480762,
	1359893119,
	2600822924,
	528734635,
	1541459225
]), E = /* @__PURE__ */ Uint32Array.from([
	1116352408,
	1899447441,
	3049323471,
	3921009573,
	961987163,
	1508970993,
	2453635748,
	2870763221,
	3624381080,
	310598401,
	607225278,
	1426881987,
	1925078388,
	2162078206,
	2614888103,
	3248222580,
	3835390401,
	4022224774,
	264347078,
	604807628,
	770255983,
	1249150122,
	1555081692,
	1996064986,
	2554220882,
	2821834349,
	2952996808,
	3210313671,
	3336571891,
	3584528711,
	113926993,
	338241895,
	666307205,
	773529912,
	1294757372,
	1396182291,
	1695183700,
	1986661051,
	2177026350,
	2456956037,
	2730485921,
	2820302411,
	3259730800,
	3345764771,
	3516065817,
	3600352804,
	4094571909,
	275423344,
	430227734,
	506948616,
	659060556,
	883997877,
	958139571,
	1322822218,
	1537002063,
	1747873779,
	1955562222,
	2024104815,
	2227730452,
	2361852424,
	2428436474,
	2756734187,
	3204031479,
	3329325298
]), D = /* @__PURE__ */ new Uint32Array(64), O = class extends w {
	A = 0;
	B = 0;
	C = 0;
	D = 0;
	E = 0;
	F = 0;
	G = 0;
	H = 0;
	constructor(e, t) {
		super(64, e, 8, !1), this.A = t[0] | 0, this.B = t[1] | 0, this.C = t[2] | 0, this.D = t[3] | 0, this.E = t[4] | 0, this.F = t[5] | 0, this.G = t[6] | 0, this.H = t[7] | 0;
	}
	get() {
		let { A: e, B: t, C: n, D: r, E: i, F: a, G: o, H: s } = this;
		return [
			e,
			t,
			n,
			r,
			i,
			a,
			o,
			s
		];
	}
	set(e, t, n, r, i, a, o, s) {
		this.A = e | 0, this.B = t | 0, this.C = n | 0, this.D = r | 0, this.E = i | 0, this.F = a | 0, this.G = o | 0, this.H = s | 0;
	}
	_cloneInto(e) {
		return (e ||= new this.constructor()).set(...this.get()), this._cloneIntoMeta(e);
	}
	process(e, t) {
		for (let n = 0; n < 16; n++, t += 4) D[n] = e.getUint32(t, !1);
		for (let e = 16; e < 64; e++) {
			let t = D[e - 15], n = D[e - 2], r = m(t, 7) ^ m(t, 18) ^ t >>> 3, i = m(n, 17) ^ m(n, 19) ^ n >>> 10;
			D[e] = i + D[e - 7] + r + D[e - 16] | 0;
		}
		let { A: n, B: r, C: i, D: a, E: o, F: s, G: c, H: l } = this;
		for (let e = 0; e < 64; e++) {
			let t = m(o, 6) ^ m(o, 11) ^ m(o, 25), u = l + t + C(o, s, c) + E[e] + D[e] | 0, d = (m(n, 2) ^ m(n, 13) ^ m(n, 22)) + ne(n, r, i) | 0;
			l = c, c = s, s = o, o = a + u | 0, a = i, i = r, r = n, n = u + d | 0;
		}
		n = n + this.A | 0, r = r + this.B | 0, i = i + this.C | 0, a = a + this.D | 0, o = o + this.E | 0, s = s + this.F | 0, c = c + this.G | 0, l = l + this.H | 0, this.set(n, r, i, a, o, s, c, l);
	}
	roundClean() {
		f(D);
	}
	destroy() {
		this.destroyed = !0, this.set(0, 0, 0, 0, 0, 0, 0, 0), f(this.buffer);
	}
}, k = class extends O {
	constructor() {
		super(32, T);
	}
}, A = /* @__PURE__ */ b(() => new k(), /* @__PURE__ */ S(1));
//#endregion
//#region node_modules/@noble/curves/utils.js
function j(e, t, n = () => {}) {
	if (!Array.isArray(e)) throw TypeError(`"${t}" expected array, got type=${typeof e}`);
	for (let r = 0; r < e.length; r++) n(e[r], `${t}[${r}]`);
	return e;
}
var M = (e, t, n) => o(e, t, n), N = a;
function re(e, t = "") {
	if (typeof e != "string") {
		let n = t && `"${t}" `;
		throw TypeError(n + "expected string, got type=" + typeof e);
	}
	return e;
}
function P(e, t = "object") {
	if (typeof e != "object" || !e || Array.isArray(e)) throw TypeError(t === "object" ? "expected valid options object" : `"${t}" expected object, got type=${typeof e}`);
	return e;
}
function F(e, t) {
	if (typeof e != "function") throw TypeError(`"${t}" is invalid: expected function, got ${typeof e}`);
	return e;
}
var ie = _, I = (...e) => ee(...e), ae = (e) => y(e), L = r, oe = (e) => x(e), se = /* @__PURE__ */ BigInt(0), ce = /* @__PURE__ */ BigInt(1), le = (e) => e ? `"${e}" ` : "";
function R(e, t = "") {
	if (typeof e != "boolean") throw TypeError(le(t) + "expected boolean, got type=" + typeof e);
	return e;
}
function ue(e) {
	if (typeof e == "bigint") {
		if (!V(e)) throw RangeError("positive bigint expected, got " + e);
	} else N(e);
	return e;
}
function z(e, t = "") {
	if (typeof e != "number") {
		let n = t && `"${t}" `;
		throw TypeError(n + "expected number, got type=" + typeof e);
	}
	if (!Number.isSafeInteger(e)) {
		let n = t && `"${t}" `;
		throw RangeError(n + "expected safe integer, got " + e);
	}
}
function de(e) {
	let t = ue(e).toString(16);
	return t.length & 1 ? "0" + t : t;
}
function fe(e) {
	if (typeof e != "string") throw TypeError("hex string expected, got " + typeof e);
	return e === "" ? se : BigInt("0x" + e);
}
function B(e) {
	return fe(_(e));
}
function pe(e) {
	return fe(_(ge(o(e)).reverse()));
}
function me(e, t) {
	if (a(t), t === 0) throw Error("zero output length is invalid");
	e = ue(e);
	let n = t * 2, r = e.toString(16);
	if (r.length > n) throw RangeError("number is too large");
	return y(r.padStart(n, "0"));
}
function he(e, t) {
	return me(e, t).reverse();
}
function ge(e) {
	return Uint8Array.from(M(e));
}
function V(e) {
	return typeof e == "bigint" && se <= e;
}
function _e(e, t, n) {
	return V(e) && V(t) && V(n) && t <= e && e < n;
}
function ve(e, t, n, r) {
	if (!_e(t, n, r)) throw RangeError("expected valid " + e + ": " + n + " <= n < " + r + ", got " + t);
}
function ye(e) {
	if (e < se) throw Error("expected non-negative bigint, got " + e);
	return e === se ? 0 : e.toString(2).length;
}
var be = (e) => (z(e, "n"), (ce << BigInt(e)) - ce);
function xe(e, t, n) {
	if (a(e, "hashLen"), a(t, "qByteLen"), typeof n != "function") throw TypeError("hmacFn must be a function");
	let r = (e) => new Uint8Array(e), i = Uint8Array.of(), o = Uint8Array.of(0), s = Uint8Array.of(1), c = r(e), l = r(e), u = 0, d = () => {
		c.fill(1), l.fill(0), u = 0;
	}, f = (...e) => n(l, I(c, ...e)), p = (e = i) => {
		l = f(o, e), c = f(), e.length !== 0 && (l = f(s, e), c = f());
	}, m = () => {
		if (u++ >= 1e3) throw Error("drbg: tried max amount of iterations");
		let e = 0, n = [];
		for (; e < t;) {
			c = f();
			let t = c.slice();
			n.push(t), e += c.length;
		}
		return I(...n);
	};
	return (e, t) => {
		d(), p(e);
		let n;
		for (; (n = t(m())) === void 0;) p();
		return d(), n;
	};
}
function H(e, t = {}, n = {}, r = "object") {
	P(e, r), P(t, "fields"), P(n, "optFields");
	function i(t, n, i) {
		let a = r === "object" ? `param "${String(t)}"` : `"${r}.${String(t)}"`, o = e[t];
		if (!Object.hasOwn(e, t) && (i ? o !== void 0 : n !== "function")) throw TypeError(`${a} is invalid: expected own property`);
		if (i && o === void 0) return;
		let s = typeof o;
		if (s !== n || o === null) throw TypeError(`${a} is invalid: expected ${n}, got ${s}`);
	}
	let a = (e, t) => Object.entries(e).forEach(([e, n]) => i(e, n, t));
	a(t, !1), a(n, !0);
}
//#endregion
//#region node_modules/@noble/curves/abstract/modular.js
var U = /* @__PURE__ */ BigInt(0), W = /* @__PURE__ */ BigInt(1), G = /* @__PURE__ */ BigInt(2), Se = /* @__PURE__ */ BigInt(3), Ce = /* @__PURE__ */ BigInt(4), we = /* @__PURE__ */ BigInt(5), Te = /* @__PURE__ */ BigInt(7), Ee = /* @__PURE__ */ BigInt(8), De = /* @__PURE__ */ BigInt(9), Oe = /* @__PURE__ */ BigInt(15), ke = /* @__PURE__ */ BigInt(16), Ae = /* @__PURE__ */ BigInt("0x10000000000000000");
function K(e, t) {
	if (t <= U) throw Error("mod: expected positive modulus, got " + t);
	let n = e % t;
	return n >= U ? n : t + n;
}
function je(e, t, n) {
	if (n <= W) throw Error("pow: expected modulus > 1, got " + n);
	if (typeof t != "bigint") throw TypeError("invalid exponent: expected bigint, got " + typeof t);
	if (t < U) throw Error("invalid exponent, negatives unsupported");
	if (t === U) return W;
	if (t === W) return e;
	let r = e % n;
	if (r < U && (r += n), t < Ae) {
		let e = W;
		for (; t > U;) t & W && (e = e * r % n), r = r * r % n, t >>= W;
		return e;
	}
	let i = [];
	for (; t > U;) i.push(Number(t & Oe)), t >>= Ce;
	let a = Array(16);
	a[0] = W, a[1] = r;
	for (let e = 2; e < 16; e++) a[e] = a[e - 1] * r % n;
	let o = a[i[i.length - 1]];
	for (let e = i.length - 2; e >= 0; e--) {
		o = o * o % n, o = o * o % n, o = o * o % n, o = o * o % n;
		let t = i[e];
		t !== 0 && (o = o * a[t] % n);
	}
	return o;
}
function Me(e, t) {
	if (e === U) throw Error("invert: expected non-zero number");
	if (t <= W) throw Error("invert: expected modulus > 1, got " + t);
	let n = K(e, t), r = t, i = U, a = W;
	for (; n !== U;) {
		let e = r / n, t = r - n * e, o = i - a * e;
		r = n, n = t, i = a, a = o;
	}
	if (r !== W) throw Error("invert: does not exist");
	return K(i, t);
}
function Ne(e, t) {
	if (t <= W) throw Error("invertCt: expected prime modulus > 1, got " + t);
	let n = K(e, t);
	if (n === U) throw Error("invertCt: expected non-zero number");
	let r = je(n, t - G, t);
	if (K(n * r, t) !== W) throw Error("invertCt: does not exist");
	return r;
}
function Pe(e, t, n) {
	let r = e;
	if (!r.eql(r.sqr(t), n)) throw Error("Cannot find square root");
}
function Fe(e, t) {
	if ((e & W) === U) throw Error(t + ": expected odd modulus, got " + e);
}
function Ie(e, t) {
	let n = e, r = (n.ORDER + W) / Ce, i = n.pow(t, r);
	return Pe(n, i, t), i;
}
function Le(e, t) {
	let n = e, r = (n.ORDER - we) / Ee, i = n.mul(t, G), a = n.pow(i, r), o = n.mul(t, a), s = n.mul(n.mul(o, G), a), c = n.mul(o, n.sub(s, n.ONE));
	return Pe(n, c, t), c;
}
function Re(e) {
	let t = qe(e), n = ze(e), r = n(t, t.neg(t.ONE)), i = n(t, r), a = n(t, t.neg(r)), o = (e + Te) / ke;
	return ((e, t) => {
		let n = e, s = n.pow(t, o), c = n.mul(s, r), l = n.mul(s, i), u = n.mul(s, a), d = n.eql(n.sqr(c), t), f = n.eql(n.sqr(l), t);
		s = n.cmov(s, c, d), c = n.cmov(u, l, f);
		let p = n.eql(n.sqr(c), t), m = n.cmov(s, c, p);
		return Pe(n, m, t), m;
	});
}
function ze(e) {
	if (e < Se) throw Error("sqrt is not defined for small field");
	Fe(e, "tonelliShanks");
	let t = e - W, n = 0;
	for (; t % G === U;) t /= G, n++;
	let r = G, i = qe(e);
	for (; Ue(i, r) === 1;) if (r++ > 1e3) throw Error("Cannot find square root: probably non-prime P");
	if (n === 1) return Ie;
	let a = i.pow(r, t), o = (t + W) / G;
	return function(e, r) {
		let i = e;
		if (i.is0(r)) return r;
		if (Ue(i, r) !== 1) throw Error("Cannot find square root");
		let s = n, c = i.mul(i.ONE, a), l = i.pow(r, t), u = i.pow(r, o);
		for (; !i.eql(l, i.ONE);) {
			if (i.is0(l)) throw Error("Cannot find square root: probably non-prime P");
			let e = 1, t = i.sqr(l);
			for (; !i.eql(t, i.ONE);) if (e++, t = i.sqr(t), e === s) throw Error("Cannot find square root");
			let n = W << BigInt(s - e - 1), r = i.pow(c, n);
			s = e, c = i.sqr(r), l = i.mul(l, c), u = i.mul(u, r);
		}
		return u;
	};
}
function Be(e) {
	return Fe(e, "Fp.sqrt"), e % Ce === Se ? Ie : e % Ee === we ? Le : e % ke === De ? Re(e) : ze(e);
}
var Ve = [
	"create",
	"isValid",
	"is0",
	"neg",
	"inv",
	"sqrt",
	"sqr",
	"eql",
	"add",
	"sub",
	"mul",
	"pow",
	"div",
	"addN",
	"subN",
	"mulN",
	"sqrN"
];
function q(e) {
	if (P(e, "field"), typeof e.ORDER != "bigint") throw TypeError("param \"ORDER\" is invalid: expected bigint, got " + typeof e.ORDER);
	z(e.BYTES, "BYTES"), z(e.BITS, "BITS");
	for (let t of Ve) F(e[t], "field." + t);
	if (e.BYTES < 1 || e.BITS < 1) throw Error("invalid field: expected BYTES/BITS > 0");
	if (e.ORDER <= W) throw Error("invalid field: expected ORDER > 1, got " + e.ORDER);
	return e;
}
function He(e, t, n = !1) {
	q(e), j(t, "nums"), R(n, "passZero");
	let r = e, i = Array(t.length).fill(n ? r.ZERO : void 0), a = t.reduce((e, t, n) => r.is0(t) ? e : (i[n] = e, r.mul(e, t)), r.ONE), o = r.inv(a);
	return t.reduceRight((e, t, n) => r.is0(t) ? e : (i[n] = r.mul(e, i[n]), r.mul(e, t)), o), i;
}
function Ue(e, t) {
	q(e);
	let n = e;
	Fe(n.ORDER, "FpLegendre");
	let r = (n.ORDER - W) / G, i = n.pow(t, r), a = n.eql(i, n.ONE), o = n.eql(i, n.ZERO), s = n.eql(i, n.neg(n.ONE));
	if (!a && !o && !s) throw Error("invalid Legendre symbol result");
	return a ? 1 : o ? 0 : -1;
}
function We(e, t) {
	if (t !== void 0 && N(t), e <= U) throw Error("invalid n length: expected positive n, got " + e);
	if (t !== void 0 && t < 1) throw Error("invalid n length: expected positive bit length, got " + t);
	let n = ye(e);
	if (t !== void 0 && t < n) throw Error(`invalid n length: expected nBitLength (${t}) >= bitLen(n) (${n})`);
	let r = t === void 0 ? n : t;
	return {
		nBitLength: r,
		nByteLength: Math.ceil(r / 8)
	};
}
var Ge = /* @__PURE__ */ new WeakMap(), Ke = class {
	ORDER;
	BITS;
	BYTES;
	isLE;
	ZERO = U;
	ONE = W;
	_lengths;
	_mod;
	constructor(e, t = {}) {
		if (e <= W) throw Error("invalid field: expected ORDER > 1, got " + e);
		let n;
		this.isLE = !1, typeof t == "object" && t && (typeof t.BITS == "number" && (n = t.BITS), typeof t.sqrt == "function" && Object.defineProperty(this, "sqrt", {
			value: t.sqrt,
			enumerable: !0
		}), typeof t.isLE == "boolean" && (this.isLE = t.isLE), t.allowedLengths && (this._lengths = Object.freeze(t.allowedLengths.slice())), typeof t.modFromBytes == "boolean" && (this._mod = t.modFromBytes));
		let { nBitLength: r, nByteLength: i } = We(e, n);
		if (i > 2048) throw Error("invalid field: expected ORDER of <= 2048 bytes");
		this.ORDER = e, this.BITS = r, this.BYTES = i, Object.freeze(this);
	}
	create(e) {
		return K(e, this.ORDER);
	}
	isValid(e) {
		if (typeof e != "bigint") throw TypeError("invalid field element: expected bigint, got " + typeof e);
		return U <= e && e < this.ORDER;
	}
	is0(e) {
		return e === U;
	}
	isValidNot0(e) {
		return !this.is0(e) && this.isValid(e);
	}
	isOdd(e) {
		return (e & W) === W;
	}
	neg(e) {
		return K(-e, this.ORDER);
	}
	eql(e, t) {
		return e === t;
	}
	sqr(e) {
		return K(e * e, this.ORDER);
	}
	add(e, t) {
		return K(e + t, this.ORDER);
	}
	sub(e, t) {
		return K(e - t, this.ORDER);
	}
	mul(e, t) {
		return K(e * t, this.ORDER);
	}
	pow(e, t) {
		return je(e, t, this.ORDER);
	}
	div(e, t) {
		return K(e * Me(t, this.ORDER), this.ORDER);
	}
	sqrN(e) {
		return e * e;
	}
	addN(e, t) {
		return e + t;
	}
	subN(e, t) {
		return e - t;
	}
	mulN(e, t) {
		return e * t;
	}
	inv(e) {
		return Me(e, this.ORDER);
	}
	sqrt(e) {
		let t = Ge.get(this);
		return t || Ge.set(this, t = Be(this.ORDER)), t(this, e);
	}
	toBytes(e) {
		return this.isLE ? he(e, this.BYTES) : me(e, this.BYTES);
	}
	fromBytes(e, t = !1) {
		M(e);
		let { _lengths: n, BYTES: r, isLE: i, ORDER: a, _mod: o } = this;
		if (n) {
			if (e.length < 1 || !n.includes(e.length) || e.length > r) throw Error("Field.fromBytes: expected " + n + " bytes, got " + e.length);
			let t = new Uint8Array(r);
			t.set(e, i ? 0 : t.length - e.length), e = t;
		}
		if (e.length !== r) throw Error("Field.fromBytes: expected " + r + " bytes, got " + e.length);
		let s = i ? pe(e) : B(e);
		if (o && (s = K(s, a)), !t && !this.isValid(s)) throw Error("invalid field element: outside of range 0..ORDER");
		return s;
	}
	invertBatch(e) {
		return He(this, e, !0);
	}
	cmov(e, t, n) {
		return R(n, "condition"), n ? t : e;
	}
};
function qe(e, t = {}) {
	return Object.freeze(Ke.prototype), new Ke(e, t);
}
function Je(e) {
	if (typeof e != "bigint") throw Error("field order must be bigint");
	if (e <= W) throw Error("field order must be greater than 1");
	let t = ye(e - W);
	return Math.ceil(t / 8);
}
function Ye(e) {
	let t = Je(e);
	return t + Math.ceil(t / 2);
}
function Xe(e, t, n = !1) {
	M(e);
	let r = e.length, i = Je(t), a = Math.max(Ye(t), 16);
	if (r < a || r > 1024) throw Error("expected " + a + "-1024 bytes of input, got " + r);
	let o = K(n ? pe(e) : B(e), t - W) + W;
	return n ? he(o, i) : me(o, i);
}
//#endregion
//#region node_modules/@noble/curves/abstract/curve.js
var Ze = /* @__PURE__ */ BigInt(0), J = /* @__PURE__ */ BigInt(1), Qe = /* @__PURE__ */ BigInt(4), $e = 16, et = 128, tt = 5, nt = 2 ** 31;
function Y(e) {
	let t = e;
	if (typeof t != "function") throw TypeError("\"Point\" expected constructor, got type=" + typeof e);
	F(t.fromAffine, "Point.fromAffine"), F(t.fromBytes, "Point.fromBytes"), F(t.fromHex, "Point.fromHex"), P(t.BASE, "Point.BASE"), P(t.ZERO, "Point.ZERO"), q(t.Fp), q(t.Fn);
}
function rt(e, t) {
	Y(e), st(t, e);
	let n = He(e.Fp, t.map((e) => e.Z));
	return t.map((t, r) => e.fromAffine(t.toAffine(n[r])));
}
function it(e, t, n = 1) {
	if (!Number.isSafeInteger(e) || e < n || e > t) throw Error("invalid window size, expected [" + n + ".." + t + "], got W=" + e);
}
function at(e, t) {
	let n = e * (4 * t + 128);
	if (n > nt) throw Error("invalid window size: table would need ~" + Math.ceil(n / 2 ** 20) + " MiB, max " + nt / 2 ** 20 + " MiB");
}
function ot(e, t) {
	if (e !== void 0) {
		F(e, "randomBytes");
		try {
			let n = e(t);
			if (!L(n) || n.length !== t) return;
		} catch {
			return;
		}
		return e;
	}
}
function st(e, t) {
	j(e, "points"), e.forEach((e, n) => {
		if (!(e instanceof t)) throw Error("invalid point at index " + n);
	});
}
function ct(e, t, n) {
	if (!Array.isArray(e)) throw Error("array of scalars expected");
	e.forEach((e, r) => {
		if (!(n === void 0 ? t.isValid(e) : V(e) && e < n)) throw Error("invalid scalar at index " + r);
	});
}
var lt = /* @__PURE__ */ new WeakMap();
function ut(e) {
	return lt.get(e) || 1;
}
function dt(e, t) {
	let n = e.double(), r = [e];
	for (let e = 1; e < t; e++) r.push(r[e - 1].add(n));
	return r;
}
function ft(e, t) {
	let n = 2 ** t, r = n / 2, i = BigInt(n - 1), a = [];
	for (; e > Ze;) {
		let t = 0;
		e & J && (t = Number(e & i), t >= r && (t -= n), e -= BigInt(t)), a.push(t), e >>= J;
	}
	return a;
}
function pt(e, t, n) {
	let r = 2 ** t, i = r / 2, a = BigInt(r - 1), o = BigInt(t), s = [];
	for (let t = 0; t < n; t++) {
		let t = Number(e & a);
		e >>= o, t > i && (t -= r, e += J), s.push(t);
	}
	if (e !== Ze) throw Error("invalid wnaf");
	return s;
}
function mt(e, t, n) {
	let r = 0;
	for (let e of n) r = Math.max(r, e.length);
	let i = e;
	for (let e = r - 1; e >= 0; e--) {
		e !== r - 1 && (i = i.double());
		for (let r = 0; r < n.length; r++) {
			let a = n[r][e];
			if (a) {
				let e = t[r][Math.abs(a) - 1 >> 1];
				i = i.add(a < 0 ? e.negate() : e);
			}
		}
	}
	return i;
}
var ht = class {
	Point;
	BASE;
	ZERO;
	randomBytes;
	wnafPrecomputes = /* @__PURE__ */ new WeakMap();
	baseCanBeBlinded;
	bits;
	constructor(e, t) {
		Y(e), this.randomBytes = ot(t, $e), this.Point = e, this.BASE = e.BASE, this.ZERO = e.ZERO, this.bits = e.Fn.BITS;
	}
	buildWnafTable(e, t, n) {
		let r = Math.ceil(n / t) + 1, i = 2 ** (t - 1), a = [], o = e;
		for (let e = 0; e < r; e++) {
			let e = o;
			for (let t = 0; t < i; t++) a.push(e), e = e.add(o);
			o = a[a.length - 1].double();
		}
		return {
			W: t,
			bits: n,
			windows: r,
			comp: a
		};
	}
	wnafCachedCT(e, t) {
		let { W: n, windows: r, comp: i } = e, a = 2 ** (n - 1), o = pt(t, n, r), s = this.ZERO, c = this.BASE;
		for (let e = 0; e < r; e++) {
			let t = o[e], n = e * a, r = Math.abs(t) - 1, l = i[n];
			for (let e = 1; e < a; e++) l = e === r ? i[n + e] : l;
			let u = l.negate();
			t === 0 ? c = c.add(i[n]) : s = s.add(t < 0 ? u : l);
		}
		return {
			p: s,
			f: c
		};
	}
	getWnafPrecomputes(e, t, n, r) {
		let i = this.wnafPrecomputes.get(t), a = i?.find((t) => t.W === e && t.bits === n);
		return a || (a = this.buildWnafTable(t, e, n), typeof r == "function" && (a = {
			...a,
			comp: r(a.comp)
		}), i || (i = [], this.wnafPrecomputes.set(t, i)), i.push(a)), a;
	}
	assertPoint(e) {
		if (!(e instanceof this.Point)) throw TypeError("\"point\" expected Point instance, got type=" + typeof e);
	}
	validateMulInput(e, t) {
		if (this.assertPoint(e), !_e(t, J, this.Point.Fn.ORDER)) throw Error("invalid scalar");
	}
	runCT(e, t, n, r) {
		let i = ut(e);
		return i === 1 ? this.fixedWindowCT(e, t, n) : this.wnafCachedCT(this.getWnafPrecomputes(i, e, n, r), t);
	}
	mulCT(e, t, n) {
		return this.validateMulInput(e, t), this.runCT(e, t, this.bits, n);
	}
	mulCTBlinded(e, t, n) {
		if (this.validateMulInput(e, t), this.randomBytes === void 0) throw Error("randomBytes is required for scalar blinding");
		let r = this.Point.Fn.BITS + et, i = this.randomBytes($e);
		if (!L(i) || i.length !== $e) throw Error("randomBytes returned invalid byte array");
		i[0] = i[0] & 63 | 128;
		let a = t + B(i) * this.Point.Fn.ORDER;
		return this.runCT(e, a, r, n);
	}
	fixedWindowCT(e, t, n) {
		let r = tt, i = be(r), a = Array(32);
		a[0] = this.ZERO;
		for (let t = 1; t < 32; t++) a[t] = a[t - 1].add(e);
		let o = Math.ceil(n / r), s = this.ZERO;
		for (let e = o - 1; e >= 0; e--) {
			if (e !== o - 1) for (let e = 0; e < r; e++) s = s.double();
			let n = Number(t >> BigInt(e * r) & i), c = a[0];
			for (let e = 1; e < 32; e++) c = e === n ? a[e] : c;
			s = s.add(c);
		}
		return {
			p: s,
			f: s
		};
	}
	shouldBlind(e, t) {
		return this.randomBytes === void 0 ? !1 : t === J || e === this.BASE && (this.baseCanBeBlinded === void 0 && (this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0()), this.baseCanBeBlinded);
	}
	mulSecret(e, t, n, r) {
		return this.shouldBlind(e, n) ? this.mulCTBlinded(e, t, r) : this.mulCT(e, t, r);
	}
	mulUnsafe(e, t, n) {
		if (this.assertPoint(e), !V(t)) throw Error("invalid scalar");
		let r = ut(e);
		if (r === 1 || t >= this.Point.Fn.ORDER) return gt(this.Point, [e], [t], !0);
		let i = this.getWnafPrecomputes(r, e, this.bits, n);
		return this.wnafCachedCT(i, t).p;
	}
	setWindowSize(e, t) {
		this.assertPoint(e), it(t, this.bits), at((Math.ceil((this.bits + et) / t) + 1) * 2 ** (t - 1), this.Point.Fp.BYTES), lt.set(e, t), this.wnafPrecomputes.delete(e);
	}
	hasWindowSize(e) {
		return ut(e) !== 1;
	}
};
function gt(e, t, n, r = !1) {
	if (Y(e), st(t, e), R(r, "allowOversized"), ct(n, e.Fn, r ? e.Fn.ORDER ** Qe : void 0), t.length !== n.length) throw Error("arrays of points and scalars must have equal length");
	let i = t.map((e) => dt(e, 4)), a = n.map((e) => ft(e, 4));
	return mt(e.ZERO, i, a);
}
function _t(e, t, n) {
	if (t) {
		if (t.ORDER !== e) throw Error("Field.ORDER must match order: Fp == p, Fn == n");
		return q(t), t;
	}
	return qe(e, { isLE: n });
}
function vt(e, t, n = {}, r) {
	if (e !== "weierstrass" && e !== "edwards") throw Error("expected curve type \"weierstrass\" or \"edwards\"");
	if (r === void 0 && (r = e === "edwards"), !t || typeof t != "object") throw Error(`expected valid ${e} CURVE object`);
	H(n);
	for (let e of [
		"p",
		"n",
		"h"
	]) {
		let n = t[e];
		if (!(V(n) && n !== Ze)) throw Error(`CURVE.${e} must be positive bigint`);
	}
	let i = _t(t.p, n.Fp, r), a = _t(t.n, n.Fn, r), o = [
		"Gx",
		"Gy",
		"a",
		e === "weierstrass" ? "b" : "d"
	];
	for (let e of o) if (!i.isValid(t[e])) throw Error(`CURVE.${e} must be valid field element of CURVE.Fp`);
	return t = Object.freeze(Object.assign({}, t)), {
		CURVE: t,
		Fp: i,
		Fn: a
	};
}
function yt(e, t) {
	return function(n) {
		let r = e(n);
		return {
			secretKey: r,
			publicKey: t(r)
		};
	};
}
//#endregion
//#region node_modules/@noble/curves/node_modules/@noble/hashes/hmac.js
var bt = class {
	oHash;
	iHash;
	blockLen;
	outputLen;
	canXOF = !1;
	finished = !1;
	destroyed = !1;
	constructor(e, t) {
		if (s(e), o(t, void 0, "key"), this.iHash = e.create(), typeof this.iHash.update != "function") throw Error("expected Hash instance");
		this.blockLen = this.iHash.blockLen, this.outputLen = this.iHash.outputLen;
		let n = this.blockLen, r = new Uint8Array(n);
		r.set(t.length > n ? e.create().update(t).digest() : t);
		for (let e = 0; e < r.length; e++) r[e] ^= 54;
		this.iHash.update(r), this.oHash = e.create();
		for (let e = 0; e < r.length; e++) r[e] ^= 106;
		this.oHash.update(r), f(r);
	}
	update(e) {
		return u(this), this.iHash.update(e), this;
	}
	digestInto(e) {
		u(this), d(e, this), this.finished = !0;
		let t = e.subarray(0, this.outputLen);
		this.iHash.digestInto(t), this.oHash.update(t), this.oHash.digestInto(t), this.destroy();
	}
	digest() {
		let e = new Uint8Array(this.oHash.outputLen);
		return this.digestInto(e), e;
	}
	_cloneInto(e) {
		e ||= Object.create(Object.getPrototypeOf(this), {});
		let { oHash: t, iHash: n, finished: r, destroyed: i, blockLen: a, outputLen: o, canXOF: s } = this;
		return e = e, e.finished = r, e.destroyed = i, e.blockLen = a, e.outputLen = o, e.canXOF = s, e.oHash = t._cloneInto(e.oHash), e.iHash = n._cloneInto(e.iHash), e;
	}
	clone() {
		return this._cloneInto();
	}
	destroy() {
		this.destroyed = !0, this.oHash.destroy(), this.iHash.destroy();
	}
}, xt = /* @__PURE__ */ (() => {
	let e = ((e, t, n) => new bt(e, t).update(n).digest());
	return e.create = (e, t) => new bt(e, t), e;
})(), St = /* @__PURE__ */ BigInt(0), X = {
	Err: class extends Error {
		constructor(e = "") {
			super(e);
		}
	},
	_tlv: {
		encode: (e, t) => {
			let { Err: n } = X;
			if (z(e, "tag"), e < 0 || e > 255) throw new n("tlv.encode: wrong tag");
			if (re(t, "data"), t.length & 1) throw new n("tlv.encode: unpadded data");
			let r = t.length / 2, i = de(r);
			if (i.length / 2 & 128) throw new n("tlv.encode: long form length too big");
			let a = r > 127 ? de(i.length / 2 | 128) : "";
			return de(e) + a + i + t;
		},
		decode(e, t) {
			let { Err: n } = X;
			t = M(t, void 0, "DER data");
			let r = 0;
			if (e < 0 || e > 255) throw new n("tlv.decode: wrong tag");
			if (t.length < 2 || t[r++] !== e) throw new n("tlv.decode: wrong tlv");
			let i = t[r++], a = !!(i & 128), o = 0;
			if (!a) o = i;
			else {
				let e = i & 127;
				if (!e) throw new n("tlv.decode(long): indefinite length not supported");
				if (e > 4) throw new n("tlv.decode(long): byte length is too big");
				let a = t.subarray(r, r + e);
				if (a.length !== e) throw new n("tlv.decode: length bytes not complete");
				if (a[0] === 0) throw new n("tlv.decode(long): zero leftmost byte");
				for (let e of a) o = o << 8 | e;
				if (r += e, o < 128) throw new n("tlv.decode(long): not minimal encoding");
			}
			let s = t.subarray(r, r + o);
			if (s.length !== o) throw new n("tlv.decode: wrong value length");
			return {
				v: s,
				l: t.subarray(r + o)
			};
		}
	},
	_int: {
		encode(e) {
			let { Err: t } = X;
			if (ue(e), e < St) throw new t("integer: negative integers are not allowed");
			let n = de(e);
			if (Number.parseInt(n[0], 16) & 8 && (n = "00" + n), n.length & 1) throw new t("unexpected DER parsing assertion: unpadded hex");
			return n;
		},
		decode(e) {
			let { Err: t } = X;
			if (e.length < 1) throw new t("invalid signature integer: empty");
			if (e[0] & 128) throw new t("invalid signature integer: negative");
			if (e.length > 1 && e[0] === 0 && !(e[1] & 128)) throw new t("invalid signature integer: unnecessary leading zero");
			return B(e);
		}
	},
	toSig(e, t) {
		let { Err: n, _int: r, _tlv: i } = X;
		if (t !== void 0 && (z(t, "maxScalarBytes"), t < 1)) throw new n("invalid signature: maxScalarBytes must be positive");
		let a = M(e, void 0, "signature"), { v: o, l: s } = i.decode(48, a);
		if (s.length) throw new n("invalid signature: left bytes after parsing");
		let { v: c, l } = i.decode(2, o), { v: u, l: d } = i.decode(2, l);
		if (d.length) throw new n("invalid signature: left bytes after parsing");
		if (t !== void 0 && (c.length > t || u.length > t)) throw new n("invalid signature: integer too large");
		return {
			r: r.decode(c),
			s: r.decode(u)
		};
	},
	hexFromSig(e) {
		let { _tlv: t, _int: n } = X;
		H(e, {
			r: "bigint",
			s: "bigint"
		}, {}, "sig");
		let r = t.encode(2, n.encode(e.r)) + t.encode(2, n.encode(e.s));
		return t.encode(48, r);
	}
}, Ct = (Object.freeze(X._tlv), Object.freeze(X._int), Object.freeze(X)), wt = (e, t) => (e + (e >= 0 ? t : -t) / Ot) / t;
function Tt(e, t, n) {
	ve("scalar", e, Z, n);
	let [[r, i], [a, o]] = t, s = wt(o * e, n), c = wt(-i * e, n), l = e - s * r - c * a, u = -s * i - c * o, d = l < Z, f = u < Z;
	d && (l = -l), f && (u = -u);
	let p = be(Math.ceil(ye(n) / 2)) + Q;
	if (l < Z || l >= p || u < Z || u >= p) throw Error("splitScalar (endomorphism): failed for k");
	return {
		k1neg: d,
		k1: l,
		k2neg: f,
		k2: u
	};
}
function Et(e) {
	if (![
		"compact",
		"recovered",
		"der"
	].includes(e)) throw Error("Signature format must be \"compact\", \"recovered\", or \"der\"");
	return e;
}
function Dt(e, t) {
	H(e);
	let n = {};
	for (let r of Object.keys(t)) n[r] = e[r] === void 0 ? t[r] : e[r];
	return R(n.lowS, "lowS"), R(n.prehash, "prehash"), n.format !== void 0 && Et(n.format), n;
}
var Z = /* @__PURE__ */ BigInt(0), Q = /* @__PURE__ */ BigInt(1), Ot = /* @__PURE__ */ BigInt(2), kt = /* @__PURE__ */ BigInt(3), At = /* @__PURE__ */ BigInt(4);
function jt(e, t = {}) {
	let n = vt("weierstrass", e, t), r = n.Fp, i = n.Fn, a = n.CURVE, { h: o, n: s } = a;
	H(t, {}, {
		allowInfinityPoint: "boolean",
		clearCofactor: "function",
		isTorsionFree: "function",
		fromBytes: "function",
		toBytes: "function",
		endo: "object",
		randomBytes: "function"
	});
	let { endo: c, allowInfinityPoint: l, clearCofactor: u, isTorsionFree: d, fromBytes: f, toBytes: p } = t, m = t.randomBytes === void 0 ? oe : t.randomBytes;
	if (c && (!r.is0(a.a) || typeof c.beta != "bigint" || !Array.isArray(c.basises))) throw Error("invalid endo: expected \"beta\": bigint and \"basises\": array");
	let h = c ? {
		beta: c.beta,
		basises: c.basises.map((e) => [...e])
	} : void 0, g = Nt(r, i);
	function _() {
		if (!r.isOdd) throw Error("compression is not supported: Field does not have .isOdd()");
	}
	function v(e, t, n) {
		if (t.is0()) {
			if (!l) throw Error("bad point: ZERO");
			return Uint8Array.of(0);
		}
		let { x: i, y: a } = t.toAffine(), o = r.toBytes(i);
		return R(n, "isCompressed"), n ? (_(), I(Mt(!r.isOdd(a)), o)) : I(Uint8Array.of(4), o, r.toBytes(a));
	}
	function y(e) {
		M(e, void 0, "Point");
		let { publicKey: t, publicKeyUncompressed: n } = g, i = e.length, a = e[0], o = e.subarray(1);
		if (l && i === 1 && a === 0) return {
			x: r.ZERO,
			y: r.ZERO
		};
		if (i === t && (a === 2 || a === 3)) {
			let e = r.fromBytes(o);
			if (!r.isValid(e)) throw Error("bad point: is not on curve, wrong x");
			let t = S(e), n;
			try {
				n = r.sqrt(t);
			} catch (e) {
				let t = e instanceof Error ? ": " + e.message : "";
				throw Error("bad point: is not on curve, sqrt error" + t);
			}
			_();
			let i = r.isOdd(n);
			return (a & 1) == 1 !== i && (n = r.neg(n)), {
				x: e,
				y: n
			};
		}
		if (i === n && a === 4) {
			let e = r.BYTES, t = r.fromBytes(o.subarray(0, e)), n = r.fromBytes(o.subarray(e, e * 2));
			if (!C(t, n)) throw Error("bad point: is not on curve");
			return {
				x: t,
				y: n
			};
		}
		throw Error(`bad point: got length ${i}, expected compressed=${t} or uncompressed=${n}`);
	}
	let ee = p === void 0 ? v : p, te = f === void 0 ? y : f, b = r.mul(a.b, kt), x = r.is0(a.a) ? (e) => r.ZERO : (e) => r.mul(a.a, e);
	function S(e) {
		let t = r.sqr(e), n = r.mul(t, e);
		return r.add(r.add(n, r.mul(e, a.a)), a.b);
	}
	function C(e, t) {
		let n = r.sqr(t), i = S(e);
		return r.eql(n, i);
	}
	if (!C(a.Gx, a.Gy)) throw Error("bad curve params: generator point");
	let ne = r.mul(r.pow(a.a, kt), At), w = r.mul(r.sqr(a.b), BigInt(27));
	if (r.is0(r.add(ne, w))) throw Error("bad curve params: a or b");
	function T(e, t, n = !1) {
		if (!r.isValid(t) || n && r.is0(t)) throw Error(`bad point coordinate ${e}`);
		return typeof t == "object" && t ? r.create(t) : t;
	}
	function E(e) {
		if (!(e instanceof A)) throw Error("Weierstrass Point expected");
	}
	function D(e) {
		if (!h || !h.basises) throw Error("no endo");
		return Tt(e, h.basises, i.ORDER);
	}
	function O(e, t, n, a) {
		if (!i.isValid(a)) throw RangeError("invalid scalar: out of range");
		if (h) {
			let { k1neg: i, k1: o, k2neg: s, k2: c } = D(a), l = new A(r.mul(n.X, h.beta), n.Y, n.Z);
			e.push(i ? n.negate() : n, s ? l.negate() : l), t.push(o, c);
		} else e.push(n), t.push(a);
	}
	let k = /* @__PURE__ */ new WeakSet();
	class A {
		static BASE = new A(a.Gx, a.Gy, r.ONE);
		static ZERO = new A(r.ZERO, r.ONE, r.ZERO);
		static Fp = r;
		static Fn = i;
		X;
		Y;
		Z;
		constructor(e, t, n) {
			this.X = T("x", e), this.Y = T("y", t, !0), this.Z = T("z", n), Object.freeze(this);
		}
		static CURVE() {
			return a;
		}
		static fromAffine(e) {
			let { x: t, y: n } = e || {};
			if (!e || !r.isValid(t) || !r.isValid(n)) throw Error("invalid affine point");
			if (e instanceof A) throw Error("projective point not allowed");
			return r.is0(t) && r.is0(n) ? A.ZERO : new A(t, n, r.ONE);
		}
		static fromBytes(e) {
			let t = A.fromAffine(te(M(e, void 0, "point")));
			return t.assertValidity(), t;
		}
		static fromHex(e) {
			return A.fromBytes(ae(e));
		}
		get x() {
			return this.toAffine().x;
		}
		get y() {
			return this.toAffine().y;
		}
		precompute(e = 6, t = !0) {
			return N.setWindowSize(this, e), t || this.multiply(kt), this;
		}
		assertValidity() {
			let e = this;
			if (e.is0()) {
				if (l && r.is0(e.X) && r.eql(e.Y, r.ONE) && r.is0(e.Z)) return;
				throw Error("bad point: ZERO");
			}
			if (k.has(e)) return;
			let { x: t, y: n } = e.toAffine();
			if (!r.isValid(t) || !r.isValid(n)) throw Error("bad point: x or y not field elements");
			if (!C(t, n)) throw Error("bad point: equation left != right");
			if (!e.isTorsionFree()) throw Error("bad point: not in prime-order subgroup");
			k.add(e);
		}
		hasEvenY() {
			let { y: e } = this.toAffine();
			if (!r.isOdd) throw Error("Field doesn't support isOdd");
			return !r.isOdd(e);
		}
		equals(e) {
			E(e);
			let { X: t, Y: n, Z: i } = this, { X: a, Y: o, Z: s } = e, c = r.eql(r.mul(t, s), r.mul(a, i)), l = r.eql(r.mul(n, s), r.mul(o, i));
			return c && l;
		}
		negate() {
			return new A(this.X, r.neg(this.Y), this.Z);
		}
		double() {
			let { X: e, Y: t, Z: n } = this, i = r.ZERO, a = r.ZERO, o = r.ZERO, s = r.mul(e, e), c = r.mul(t, t), l = r.mul(n, n), u = r.mul(e, t);
			return u = r.add(u, u), o = r.mul(e, n), o = r.add(o, o), i = x(o), a = r.mul(b, l), a = r.add(i, a), i = r.sub(c, a), a = r.add(c, a), a = r.mul(i, a), i = r.mul(u, i), o = r.mul(b, o), l = x(l), u = r.sub(s, l), u = x(u), u = r.add(u, o), o = r.add(s, s), s = r.add(o, s), s = r.add(s, l), s = r.mul(s, u), a = r.add(a, s), l = r.mul(t, n), l = r.add(l, l), s = r.mul(l, u), i = r.sub(i, s), o = r.mul(l, c), o = r.add(o, o), o = r.add(o, o), new A(i, a, o);
		}
		add(e) {
			E(e);
			let { X: t, Y: n, Z: i } = this, { X: a, Y: o, Z: s } = e, c = r.ZERO, l = r.ZERO, u = r.ZERO, d = r.mul(t, a), f = r.mul(n, o), p = r.mul(i, s), m = r.add(t, n), h = r.add(a, o);
			m = r.mul(m, h), h = r.add(d, f), m = r.sub(m, h), h = r.add(t, i);
			let g = r.add(a, s);
			return h = r.mul(h, g), g = r.add(d, p), h = r.sub(h, g), g = r.add(n, i), c = r.add(o, s), g = r.mul(g, c), c = r.add(f, p), g = r.sub(g, c), u = x(h), c = r.mul(b, p), u = r.add(c, u), c = r.sub(f, u), u = r.add(f, u), l = r.mul(c, u), f = r.add(d, d), f = r.add(f, d), p = x(p), h = r.mul(b, h), f = r.add(f, p), p = r.sub(d, p), p = x(p), h = r.add(h, p), d = r.mul(f, h), l = r.add(l, d), d = r.mul(g, h), c = r.mul(m, c), c = r.sub(c, d), d = r.mul(m, f), u = r.mul(g, u), u = r.add(u, d), new A(c, l, u);
		}
		subtract(e) {
			return E(e), this.add(e.negate());
		}
		is0() {
			return this.equals(A.ZERO);
		}
		multiply(e) {
			if (!i.isValidNot0(e)) throw RangeError("invalid scalar: out of range");
			let { p: t, f: n } = N.mulSecret(this, e, o, j);
			return j([t, n])[0];
		}
		multiplyUnsafe(e) {
			let t = this, n = e;
			if (!i.isValid(n)) throw RangeError("invalid scalar: out of range");
			if (n === Z || t.is0()) return A.ZERO;
			if (n === Q) return t;
			if (N.hasWindowSize(this)) return N.mulUnsafe(t, n, j);
			let r = [], a = [];
			return O(r, a, t, n), gt(A, r, a);
		}
		mulAddUnsafe(e, t, n) {
			E(t);
			let r = [], i = [];
			return O(r, i, this, e), O(r, i, t, n), gt(A, r, i);
		}
		toAffine(e) {
			let t = this, n = e;
			if (n != null && !r.isValid(n)) throw RangeError("\"invertedZ\" expected valid field element");
			let { X: i, Y: a, Z: o } = t;
			if (r.eql(o, r.ONE)) return {
				x: i,
				y: a
			};
			let s = t.is0();
			n ??= s ? r.ONE : r.inv(o);
			let c = r.mul(i, n), l = r.mul(a, n), u = r.mul(o, n);
			if (s) return {
				x: r.ZERO,
				y: r.ZERO
			};
			if (!r.eql(u, r.ONE)) throw Error("invZ was invalid");
			return {
				x: c,
				y: l
			};
		}
		isTorsionFree() {
			return o === Q ? !0 : d ? d(A, this) : N.mulUnsafe(this, s).is0();
		}
		clearCofactor() {
			return o === Q ? this : u ? u(A, this) : this.multiplyUnsafe(o);
		}
		isSmallOrder() {
			return o === Q ? this.is0() : this.clearCofactor().is0();
		}
		toBytes(e = !0) {
			return R(e, "isCompressed"), this.assertValidity(), ee(A, this, e);
		}
		toHex(e = !0) {
			return ie(this.toBytes(e));
		}
		toString() {
			return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
		}
	}
	let j = (e) => rt(A, e), N = new ht(A, m);
	return N.bits >= 6 && A.BASE.precompute(6), Object.freeze(A.prototype), Object.freeze(A), A;
}
function Mt(e) {
	return Uint8Array.of(e ? 2 : 3);
}
function Nt(e, t) {
	return {
		secretKey: t.BYTES,
		publicKey: 1 + e.BYTES,
		publicKeyUncompressed: 1 + 2 * e.BYTES,
		publicKeyHasPrefix: !0,
		signature: 2 * t.BYTES
	};
}
function Pt(e, t = {}) {
	Y(e);
	let { Fn: n } = e, r = t.randomBytes === void 0 ? oe : t.randomBytes, i = Object.assign(Nt(e.Fp, n), { seed: Math.max(Ye(n.ORDER), 16) });
	function a(e) {
		try {
			let t = n.fromBytes(e);
			return n.isValidNot0(t);
		} catch {
			return !1;
		}
	}
	function o(t, n) {
		let { publicKey: r, publicKeyUncompressed: a } = i;
		try {
			let i = t.length;
			return n === !0 && i !== r || n === !1 && i !== a ? !1 : !e.fromBytes(t).is0();
		} catch {
			return !1;
		}
	}
	function s(e) {
		return e = e === void 0 ? r(i.seed) : e, Xe(M(e, i.seed, "seed"), n.ORDER);
	}
	function c(t, r = !0) {
		return e.BASE.multiply(n.fromBytes(t)).toBytes(r);
	}
	function l(e) {
		let { secretKey: t, publicKey: r, publicKeyUncompressed: a } = i, o = n._lengths;
		if (!L(e)) return;
		let s = M(e, void 0, "key").length, c = s === r || s === a, l = s === t || !!o?.includes(s);
		if (!(c && l)) return c;
	}
	function u(t, r, i = !0) {
		if (l(t) === !0) throw Error("first arg must be private key");
		if (l(r) === !1) throw Error("second arg must be public key");
		let a = n.fromBytes(t), o = e.fromBytes(r);
		if (o.is0()) throw Error("invalid public key: point at infinity");
		return o.multiply(a).toBytes(i);
	}
	let d = {
		isValidSecretKey: a,
		isValidPublicKey: o,
		randomSecretKey: s
	}, f = yt(s, c);
	return Object.freeze(d), Object.freeze(i), Object.freeze({
		getPublicKey: c,
		getSharedSecret: u,
		keygen: f,
		Point: e,
		utils: d,
		lengths: i
	});
}
function Ft(e, t, n = {}) {
	Y(e);
	let r = t;
	s(r), H(n, {}, {
		hmac: "function",
		lowS: "boolean",
		randomBytes: "function",
		bits2int: "function",
		bits2int_modN: "function"
	});
	let i = Object.assign({}, n), a = i.randomBytes === void 0 ? oe : i.randomBytes, o = i.hmac === void 0 ? (e, t) => xt(r, e, t) : i.hmac, { Fp: c, Fn: l } = e, { ORDER: u, BITS: d } = l, f = Ye(u), p = ot(a, f), { keygen: m, getPublicKey: h, getSharedSecret: g, utils: _, lengths: v } = Pt(e, i), y = {
		prehash: !0,
		lowS: typeof i.lowS != "boolean" || i.lowS,
		format: "compact",
		extraEntropy: !1
	}, ee = u * Ot + Q < c.ORDER;
	function te(e) {
		return e > u >> Q;
	}
	function b(e, t) {
		if (!l.isValidNot0(t)) throw Error(`invalid signature ${e}: out of range 1..Point.Fn.ORDER`);
		return t;
	}
	function x() {
		if (!c.isOdd) throw Error("Field doesn't support isOdd");
	}
	function S(e, t, n) {
		return x(), (e === n ? 0 : 2) | Number(c.isOdd(t));
	}
	function C() {
		if (ee) throw Error("\"recovered\" sig type is not supported for cofactor >2 curves");
	}
	function ne(e, t) {
		Et(t);
		let n = v.signature;
		return M(e, t === "compact" ? n : t === "recovered" ? n + 1 : void 0);
	}
	class w {
		r;
		s;
		recovery;
		constructor(e, t, n) {
			if (this.r = b("r", e), this.s = b("s", t), n != null) {
				if (C(), ![
					0,
					1,
					2,
					3
				].includes(n)) throw Error("invalid recovery id");
				this.recovery = n;
			}
			Object.freeze(this);
		}
		static fromBytes(e, t = y.format) {
			ne(e, t);
			let n;
			if (t === "der") {
				if (e.length > 2 * l.BYTES + 16) throw new Ct.Err("invalid signature: DER signature too long");
				let { r: t, s: n } = Ct.toSig(M(e), l.BYTES + 1);
				return new w(t, n);
			}
			t === "recovered" && (n = e[0], t = "compact", e = e.subarray(1));
			let r = v.signature / 2, i = e.subarray(0, r), a = e.subarray(r, r * 2);
			return new w(l.fromBytes(i), l.fromBytes(a), n);
		}
		static fromHex(e, t) {
			return this.fromBytes(ae(e), t);
		}
		assertRecovery() {
			let { recovery: e } = this;
			if (e == null) throw Error("invalid recovery id: must be present");
			return e;
		}
		addRecoveryBit(e) {
			return new w(this.r, this.s, e);
		}
		recoverPublicKey(t) {
			let { r: n, s: r } = this, i = this.assertRecovery(), a = i === 2 || i === 3 ? n + u : n;
			if (!c.isValid(a)) throw Error("invalid recovery id: sig.r+curve.n != R.x");
			let o = c.toBytes(a), s = e.fromBytes(I(Mt(!(i & 1)), o)), d = l.inv(a), f = E(M(t, void 0, "msgHash")), p = l.create(-f * d), m = l.create(r * d), h = e.BASE.mulAddUnsafe(p, s, m);
			if (h.is0()) throw Error("invalid recovery: point at infinify");
			return h.assertValidity(), h;
		}
		hasHighS() {
			return te(this.s);
		}
		toBytes(e = y.format) {
			if (Et(e), e === "der") return ae(Ct.hexFromSig(this));
			let { r: t, s: n } = this, r = l.toBytes(t), i = l.toBytes(n);
			return e === "recovered" ? (C(), I(Uint8Array.of(this.assertRecovery()), r, i)) : I(r, i);
		}
		toHex(e) {
			return ie(this.toBytes(e));
		}
	}
	Object.freeze(w.prototype), Object.freeze(w);
	let T = i.bits2int === void 0 ? function(e) {
		if (e.length > 8192) throw Error("input is too large");
		let t = B(e), n = e.length * 8 - d;
		return n > 0 ? t >> BigInt(n) : t;
	} : i.bits2int, E = i.bits2int_modN === void 0 ? function(e) {
		return l.create(T(e));
	} : i.bits2int_modN, D = be(d);
	function O(e) {
		return ve("num < 2^" + d, e, Z, D), l.toBytes(e);
	}
	function k(e, t) {
		return M(e, void 0, "message"), t ? M(r(e), void 0, "prehashed message") : e;
	}
	function A(t, n, r) {
		let { lowS: i, prehash: o, extraEntropy: s } = Dt(r, y);
		t = k(t, o);
		let c = E(t), d = l.fromBytes(n);
		if (!l.isValidNot0(d)) throw Error("invalid private key");
		let m = [O(d), O(c)];
		if (s != null && s !== !1) {
			let e = s === !0 ? a(v.secretKey) : s;
			m.push(M(e, void 0, "extraEntropy"));
		}
		let h = I(...m), g = c;
		function _(t) {
			let n = T(t);
			if (!l.isValidNot0(n)) return;
			let r = e.BASE.multiply(n).toAffine(), a = l.create(r.x);
			if (a === Z) return;
			let o;
			if (p !== void 0) {
				let e = B(Xe(p(f), u)), t = l.inv(l.mul(e, n)), r = l.mul(e, g), i = l.mul(e, d);
				o = l.create(t * l.create(r + i * a));
			} else {
				let e = Ne(n, u);
				o = l.create(e * l.create(g + a * d));
			}
			if (o === Z) return;
			let s = S(r.x, r.y, a), c = o;
			return i && te(o) && (c = l.neg(o), s ^= 1), new w(a, c, ee ? void 0 : s);
		}
		return {
			seed: h,
			k2sig: _
		};
	}
	function j(e, t, n = {}) {
		let { seed: i, k2sig: a } = A(e, t, n);
		return xe(r.outputLen, l.BYTES, o)(i, a).toBytes(n.format);
	}
	function N(t, n, r, i = {}) {
		let { lowS: a, prehash: o, format: s } = Dt(i, y);
		if (r = M(r, void 0, "publicKey"), n = k(n, o), !L(t)) {
			let e = t instanceof w ? ", use sig.toBytes()" : "";
			throw Error("verify expects Uint8Array signature" + e);
		}
		ne(t, s);
		try {
			let i = w.fromBytes(t, s), o = e.fromBytes(r);
			if (o.is0() || a && i.hasHighS()) return !1;
			let { r: c, s: u } = i, d = E(n), f = l.inv(u), p = l.create(d * f), m = l.create(c * f), h = e.BASE.mulAddUnsafe(p, o, m);
			if (h.is0()) return !1;
			let g = h.toAffine();
			return !(l.create(g.x) !== c || s === "recovered" && i.recovery !== S(g.x, g.y, c));
		} catch {
			return !1;
		}
	}
	function re(e, t, n = {}) {
		let { prehash: r } = Dt(n, y);
		return t = k(t, r), w.fromBytes(e, "recovered").recoverPublicKey(t).toBytes();
	}
	return Object.freeze({
		keygen: m,
		getPublicKey: h,
		getSharedSecret: g,
		utils: _,
		lengths: v,
		Point: e,
		sign: j,
		verify: N,
		recoverPublicKey: re,
		Signature: w,
		hash: r
	});
}
var It = /* @__PURE__ */ Ft(/* @__PURE__ */ jt({
	p: BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff"),
	n: BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"),
	h: BigInt(1),
	a: BigInt("0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc"),
	b: BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b"),
	Gx: BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"),
	Gy: BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5")
}), A);
//#endregion
//#region src/lib/identity/pkcs8.ts
function Lt(...e) {
	let t = e.reduce((e, t) => e + t.length, 0), n = new Uint8Array(t), r = 0;
	for (let t of e) n.set(t, r), r += t.length;
	return n;
}
function Rt(e) {
	let t = It.getPublicKey(e, !1);
	return Lt(new Uint8Array([
		48,
		129,
		135,
		2,
		1,
		0,
		48,
		19,
		6,
		7,
		42,
		134,
		72,
		206,
		61,
		2,
		1,
		6,
		8,
		42,
		134,
		72,
		206,
		61,
		3,
		1,
		7,
		4,
		109,
		48,
		107,
		2,
		1,
		1,
		4,
		32
	]), e, new Uint8Array([
		161,
		68,
		3,
		66,
		0
	]), t);
}
//#endregion
//#region src/lib/identity/webcrypto.ts
var zt = {
	name: "ECDSA",
	namedCurve: "P-256"
}, Bt = {
	name: "ECDSA",
	hash: "SHA-256"
}, Vt = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"), $ = (e) => e.slice().buffer, Ht = class {
	keyPair = null;
	generation = 0;
	dispose() {
		this.generation++, this.keyPair = null;
	}
	requirePair() {
		if (!this.keyPair) throw Error("identity_not_initialized");
		return this.keyPair;
	}
	assertCurrent(e) {
		if (e !== this.generation) throw Error("identity_disposed");
	}
	async create() {
		let e = crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32));
		try {
			return await this.fromSeed(e);
		} finally {
			e.fill(0);
		}
	}
	async fromSeed(e) {
		if (e.length !== 32) throw Error("identity_seed_must_be_32_bytes");
		this.dispose();
		let t = this.generation, n = e.slice(), r, i;
		try {
			for (;;) {
				let e = 0n;
				for (let t of n) e = e << 8n | BigInt(t);
				if (e > 0n && e < Vt) break;
				let r = $(n);
				try {
					let e = new Uint8Array(await crypto.subtle.digest("SHA-256", r));
					n.fill(0), n = e;
				} finally {
					new Uint8Array(r).fill(0);
				}
				this.assertCurrent(t);
			}
			r = Rt(n), i = $(r);
			let e = await crypto.subtle.importKey("pkcs8", i, zt, !1, ["sign"]);
			this.assertCurrent(t);
			let a = r.slice(-65), o = await crypto.subtle.importKey("raw", $(a), zt, !0, ["verify"]);
			return this.assertCurrent(t), this.keyPair = {
				privateKey: e,
				publicKey: o
			}, { publicKey: a };
		} finally {
			n.fill(0), r?.fill(0), i && new Uint8Array(i).fill(0);
		}
	}
	async sign(e) {
		let t = this.requirePair(), n = this.generation, r = await crypto.subtle.sign(Bt, t.privateKey, $(e));
		return this.assertCurrent(n), new Uint8Array(r);
	}
	async verify(e, t) {
		return crypto.subtle.verify(Bt, this.requirePair().publicKey, $(t), $(e));
	}
	async verifyWithPublicKey(e, t, n) {
		let r = await crypto.subtle.importKey("raw", $(e), zt, !1, ["verify"]);
		return crypto.subtle.verify(Bt, r, $(n), $(t));
	}
	async getPublicKeyBytes() {
		let e = this.generation, t = await crypto.subtle.exportKey("raw", this.requirePair().publicKey);
		return this.assertCurrent(e), new Uint8Array(t);
	}
}, Ut = "qpzry9x8gf2tvdw0s3jn54khce6mua7l", Wt = [
	996825010,
	642813549,
	513874426,
	1027748829,
	705979059
], Gt = 734539939, Kt = "mesh", qt = 1;
function Jt(e) {
	let t = 1;
	for (let n of e) {
		let e = t >>> 25;
		t = (t & 33554431) << 5 ^ n;
		for (let n = 0; n < 5; n++) e >>> n & 1 && (t ^= Wt[n]);
	}
	return t >>> 0;
}
function Yt(e) {
	let t = [...e].map((e) => e.charCodeAt(0));
	return [
		...t.map((e) => e >>> 5),
		0,
		...t.map((e) => e & 31)
	];
}
function Xt(e) {
	let t = (Jt([
		...Yt(Kt),
		...e,
		0,
		0,
		0,
		0,
		0,
		0
	]) ^ Gt) >>> 0;
	return Array.from({ length: 6 }, (e, n) => t >>> 5 * (5 - n) & 31);
}
function Zt(e, t, n, r) {
	let i = 0, a = 0, o = (1 << n) - 1, s = [];
	for (let r of e) {
		if (r < 0 || r >= 1 << t) return null;
		for (i = (i << t | r) & 65535, a += t; a >= n;) a -= n, s.push(i >>> a & o);
	}
	if (r) a > 0 && s.push(i << n - a & o);
	else if (a >= t || (i << n - a & o) !== 0) return null;
	return s;
}
function Qt(e) {
	if (!(e instanceof Uint8Array) || e.length !== 20) throw Error("invalid_account_fingerprint");
	let t = /* @__PURE__ */ new Uint8Array(21);
	t[0] = qt, t.set(e, 1);
	let n = Zt(t, 8, 5, !0);
	if (!n) throw Error("invalid_account_fingerprint");
	return `${Kt}1${[...n, ...Xt(n)].map((e) => Ut[e]).join("")}`;
}
function $t(e) {
	if (typeof e != "string" || !e.startsWith(`${Kt}1`) || e.length !== 45) return null;
	let t = [...e.slice(5)].map((e) => Ut.indexOf(e));
	if (t.some((e) => e < 0) || Jt([...Yt(Kt), ...t]) !== Gt) return null;
	let n = Zt(t.slice(0, -6), 5, 8, !1);
	if (!n || n.length !== 21 || n[0] !== qt) return null;
	let r = new Uint8Array(n.slice(1));
	return Qt(r) === e ? r : null;
}
function en(e) {
	return $t(e) !== null;
}
//#endregion
//#region src/lib/addressing/account-id.js
var tn = new TextEncoder().encode("MeshAutonomy/account/v1\0P-256\0");
async function nn(e, t = crypto.subtle) {
	if (!(e instanceof Uint8Array) || e.length !== 65 || e[0] !== 4) throw Error("invalid_public_key");
	let n = new Uint8Array(tn.length + e.length);
	n.set(tn), n.set(e, tn.length);
	let r = await t.digest("SHA-256", n);
	return Qt(new Uint8Array(r).slice(0, 20));
}
//#endregion
//#region plugins/automesh-notifier/browser/identity.ts
async function rn(e) {
	let t = new Ht(), { publicKey: n } = await t.fromSeed(e);
	return {
		address: await nn(n),
		provider: t
	};
}
//#endregion
export { en as isValidAccountId, rn as senderIdentity };
