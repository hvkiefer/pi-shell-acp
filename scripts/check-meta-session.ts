/**
 * check-meta-session — deterministic gate for the 1.0.0 meta-bridge record
 * authority (step 2). Pure functions + a real temp-dir scan; no backend, no
 * network, no hook. Safe in the `pnpm check` static floor.
 *
 * Proves the contract the later hook/CLI/mailbox steps build on:
 *   - mint stamps a valid garden id + seeded read-receipt slot;
 *   - serialize is deterministic and round-trips through parse;
 *   - parse crashes (not warns) on every malformed shape;
 *   - scanByNativeId is the lookup AUTHORITY by record BODY, never by filename;
 *   - decideUpsert keys on record existence (idempotent), refuses identity drift;
 *   - the pre-drilled read-receipt mutators touch only their own field.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	decideUpsert,
	META_BACKEND_DESCRIPTORS,
	META_SCHEMA_VERSION,
	type MetaMintInput,
	MetaRecordError,
	markDelivered,
	markEnqueued,
	markRead,
	metaRecordFilename,
	mintMetaRecord,
	parseMetaRecord,
	scanByNativeId,
	serializeMetaRecord,
} from "../pi-extensions/lib/meta-session.ts";

const SESSION_ID_RE = /^\d{8}T\d{6}-[0-9a-f]{6}$/;
const T0 = new Date("2026-06-05T05:00:00.000Z");
const T1 = new Date("2026-06-05T06:30:00.000Z");

let assertions = 0;
function check(label: string, fn: () => void): void {
	fn();
	assertions += 1;
	process.stdout.write(`[check-meta-session] ${label}: ok\n`);
}

function claudeInput(overrides: Partial<MetaMintInput> = {}): MetaMintInput {
	return {
		backend: "claude-code",
		nativeSessionId: "11111111-1111-4111-8111-111111111111",
		transcriptPath: "/home/u/.claude/projects/-home-u-proj/11111111.jsonl",
		cwd: "/home/u/proj",
		...overrides,
	};
}

function expectThrows(label: string, fn: () => void): void {
	check(label, () => {
		assert.throws(fn, MetaRecordError, `${label}: expected MetaRecordError`);
	});
}

// ---------------------------------------------------------------- mint
check("mint: garden id matches the SSOT grammar", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	assert.match(r.gardenId, SESSION_ID_RE);
});

check("mint: createdAt == lastSeen at birth, ISO from `now`", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	assert.equal(r.createdAt, T0.toISOString());
	assert.equal(r.lastSeen, T0.toISOString());
});

check("mint: delivery slot seeded from backend descriptor, receipts null", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const d = META_BACKEND_DESCRIPTORS["claude-code"];
	assert.equal(r.delivery.wakeMode, d.wakeMode);
	assert.equal(r.delivery.wakeMode, "self-fetch");
	assert.equal(r.delivery.deliveryLevel, d.deliveryLevel);
	assert.equal(r.delivery.lastEnqueuedAt, null);
	assert.equal(r.delivery.lastDeliveredAt, null);
	assert.equal(r.delivery.lastReadAt, null);
	assert.equal(r.schemaVersion, META_SCHEMA_VERSION);
});

check("mint: agy/codex direct-inject descriptors differ from claude self-fetch", () => {
	const agy = mintMetaRecord(claudeInput({ backend: "antigravity", nativeSessionId: "agy-conv-1" }), T0);
	const codex = mintMetaRecord(claudeInput({ backend: "codex", nativeSessionId: "codex-thread-1" }), T0);
	assert.equal(agy.delivery.wakeMode, "direct-inject");
	assert.equal(codex.delivery.wakeMode, "direct-inject");
});

expectThrows("mint: empty nativeSessionId throws", () => mintMetaRecord(claudeInput({ nativeSessionId: "" }), T0));
expectThrows("mint: empty transcriptPath throws", () => mintMetaRecord(claudeInput({ transcriptPath: "" }), T0));
expectThrows("mint: empty cwd throws", () => mintMetaRecord(claudeInput({ cwd: "" }), T0));
expectThrows("mint: bad backend throws", () =>
	mintMetaRecord(claudeInput({ backend: "gemini" as unknown as MetaMintInput["backend"] }), T0),
);

// ---------------------------------------------------------------- serialize / parse
check("serialize: deterministic (same record → byte-identical)", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	assert.equal(serializeMetaRecord(r), serializeMetaRecord(r));
});

check("serialize → parse round-trips to a deep-equal record", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	assert.deepEqual(parseMetaRecord(serializeMetaRecord(r)), r);
});

check("serialize: trailing newline, 2-space indent, stable key order", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const text = serializeMetaRecord(r);
	assert.ok(text.endsWith("}\n"));
	const keys = Object.keys(JSON.parse(text));
	assert.deepEqual(keys, [
		"schemaVersion",
		"gardenId",
		"backend",
		"nativeSessionId",
		"transcriptPath",
		"cwd",
		"createdAt",
		"lastSeen",
		"delivery",
	]);
});

expectThrows("parse: invalid JSON throws", () => parseMetaRecord("{not json"));
expectThrows("parse: array (non-object) throws", () => parseMetaRecord("[]"));
expectThrows("parse: wrong schemaVersion throws", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const bad = JSON.parse(serializeMetaRecord(r));
	bad.schemaVersion = 2;
	parseMetaRecord(JSON.stringify(bad));
});
expectThrows("parse: malformed gardenId throws", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const bad = JSON.parse(serializeMetaRecord(r));
	bad.gardenId = "not-a-garden-id";
	parseMetaRecord(JSON.stringify(bad));
});
expectThrows("parse: unknown backend throws", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const bad = JSON.parse(serializeMetaRecord(r));
	bad.backend = "openai";
	parseMetaRecord(JSON.stringify(bad));
});
expectThrows("parse: missing nativeSessionId throws", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const bad = JSON.parse(serializeMetaRecord(r));
	delete bad.nativeSessionId;
	parseMetaRecord(JSON.stringify(bad));
});
expectThrows("parse: bad delivery.wakeMode throws", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const bad = JSON.parse(serializeMetaRecord(r));
	bad.delivery.wakeMode = "magic";
	parseMetaRecord(JSON.stringify(bad));
});
expectThrows("parse: delivery not an object throws", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const bad = JSON.parse(serializeMetaRecord(r));
	bad.delivery = "nope";
	parseMetaRecord(JSON.stringify(bad));
});
expectThrows("parse: backend↔wakeMode contradiction throws (claude record claiming direct-inject)", () => {
	const r = mintMetaRecord(claudeInput(), T0); // claude-code → self-fetch
	const bad = JSON.parse(serializeMetaRecord(r));
	bad.delivery.wakeMode = "direct-inject"; // valid mode, wrong for this backend
	parseMetaRecord(JSON.stringify(bad));
});
check("parse: matching backend↔wakeMode round-trips (codex direct-inject)", () => {
	const r = mintMetaRecord(claudeInput({ backend: "codex", nativeSessionId: "codex-thread-X" }), T0);
	assert.deepEqual(parseMetaRecord(serializeMetaRecord(r)), r);
});

// ---------------------------------------------------------------- filename
check("metaRecordFilename: <gardenId>.meta.json", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	assert.equal(metaRecordFilename(r), `${r.gardenId}.meta.json`);
});

// ---------------------------------------------------------------- scanByNativeId (in-memory)
check("scanByNativeId: ignores non-.meta.json entries", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const reader = (f: string) => {
		if (f === "x.meta.json") return serializeMetaRecord(r);
		throw new Error(`unexpected read ${f}`);
	};
	const found = scanByNativeId(["README.md", "notes.txt", "x.meta.json"], r.nativeSessionId, reader);
	assert.deepEqual(found, r);
});

check("scanByNativeId: returns null when no body matches", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const found = scanByNativeId(["a.meta.json"], "no-such-native-id", () => serializeMetaRecord(r));
	assert.equal(found, null);
});

check("scanByNativeId: malformed entry is skipped via onSkip, scan continues", () => {
	const good = mintMetaRecord(claudeInput(), T0);
	const skipped: string[] = [];
	const reader = (f: string) => (f === "bad.meta.json" ? "{broken" : serializeMetaRecord(good));
	const found = scanByNativeId(["bad.meta.json", "good.meta.json"], good.nativeSessionId, reader, (f) =>
		skipped.push(f),
	);
	assert.deepEqual(found, good);
	assert.deepEqual(skipped, ["bad.meta.json"]);
});

expectThrows("scanByNativeId: duplicate nativeSessionId is authority ambiguity → throws", () => {
	// Two records (different garden ids) claiming the SAME nativeSessionId. The
	// native→garden mapping must be unique; the scan must fail-fast, not pick one.
	const a = mintMetaRecord(claudeInput({ nativeSessionId: "dup-native" }), T0);
	const b = mintMetaRecord(claudeInput({ nativeSessionId: "dup-native" }), T1);
	assert.notEqual(a.gardenId, b.gardenId);
	const reader = (f: string) => (f === "a.meta.json" ? serializeMetaRecord(a) : serializeMetaRecord(b));
	scanByNativeId(["a.meta.json", "b.meta.json"], "dup-native", reader);
});

// ---------------------------------------------------------------- decideUpsert
check("decideUpsert: absent → create, fresh garden id", () => {
	const dec = decideUpsert(null, claudeInput(), T0);
	assert.equal(dec.action, "create");
	assert.match(dec.record.gardenId, SESSION_ID_RE);
});

check("decideUpsert: present → attach, identity preserved, lastSeen refreshed", () => {
	const created = decideUpsert(null, claudeInput(), T0).record;
	const moved = claudeInput({ transcriptPath: "/new/path.jsonl", cwd: "/new/cwd" });
	const dec = decideUpsert(created, moved, T1);
	assert.equal(dec.action, "attach");
	assert.equal(dec.record.gardenId, created.gardenId); // same id
	assert.equal(dec.record.createdAt, created.createdAt); // birth preserved
	assert.equal(dec.record.lastSeen, T1.toISOString()); // refreshed
	assert.equal(dec.record.transcriptPath, "/new/path.jsonl"); // cheap pointer updated
	assert.equal(dec.record.cwd, "/new/cwd");
});

check("decideUpsert: idempotent — create then attach never mints a 2nd id", () => {
	const first = decideUpsert(null, claudeInput(), T0).record;
	const second = decideUpsert(first, claudeInput(), T1);
	assert.equal(second.action, "attach");
	assert.equal(second.record.gardenId, first.gardenId);
});

expectThrows("decideUpsert: nativeSessionId mismatch throws (wrong scan key)", () => {
	const created = decideUpsert(null, claudeInput(), T0).record;
	decideUpsert(created, claudeInput({ nativeSessionId: "different-id" }), T1);
});

expectThrows("decideUpsert: backend drift for same native id throws", () => {
	const created = decideUpsert(null, claudeInput(), T0).record;
	// same nativeSessionId, different backend → corruption
	decideUpsert(created, claudeInput({ backend: "codex" }), T1);
});

// ---------------------------------------------------------------- read-receipt mutators
check("read-receipt mutators touch only their own field", () => {
	const base = mintMetaRecord(claudeInput(), T0);
	const enq = markEnqueued(base, T1);
	assert.equal(enq.delivery.lastEnqueuedAt, T1.toISOString());
	assert.equal(enq.delivery.lastDeliveredAt, null);
	assert.equal(enq.delivery.lastReadAt, null);

	const del = markDelivered(enq, T1);
	assert.equal(del.delivery.lastDeliveredAt, T1.toISOString());
	assert.equal(del.delivery.lastReadAt, null);

	const read = markRead(del, T1);
	assert.equal(read.delivery.lastReadAt, T1.toISOString());
	// original untouched (pure)
	assert.equal(base.delivery.lastEnqueuedAt, null);
});

// ---------------------------------------------------------------- temp-dir: authority = body, not filename
check("temp-dir scan: authority is record BODY, not filename", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-session-scan-"));
	try {
		const a = mintMetaRecord(claudeInput({ nativeSessionId: "native-A" }), T0);
		const b = mintMetaRecord(claudeInput({ backend: "codex", nativeSessionId: "native-B" }), T1);
		// Write A under its honest filename, but B under a DECOY filename whose
		// garden id does not match B's body — a filename-parser would be fooled.
		fs.writeFileSync(path.join(dir, metaRecordFilename(a)), serializeMetaRecord(a));
		const decoyName = "19990101T000000-deadbe.meta.json";
		assert.notEqual(decoyName, metaRecordFilename(b));
		fs.writeFileSync(path.join(dir, decoyName), serializeMetaRecord(b));
		fs.writeFileSync(path.join(dir, "unrelated.txt"), "noise");

		const entries = fs.readdirSync(dir);
		const reader = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");

		const foundA = scanByNativeId(entries, "native-A", reader);
		assert.ok(foundA && foundA.gardenId === a.gardenId);
		// B is found by BODY nativeSessionId despite the decoy filename.
		const foundB = scanByNativeId(entries, "native-B", reader);
		assert.ok(foundB && foundB.gardenId === b.gardenId && foundB.backend === "codex");
		assert.equal(scanByNativeId(entries, "native-Z", reader), null);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

process.stdout.write(`[check-meta-session] ${assertions} assertions ok\n`);
