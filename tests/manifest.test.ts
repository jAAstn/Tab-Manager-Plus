"use strict";

// Unit tests for scripts/manifest.mjs: the Brave manifest the build writes, and
// the committed Chrome manifest it is made from.
// Run with: npm test  (== node --test tests/)

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { braveManifest } from "../scripts/manifest.mjs";

/** The committed manifest, read from disk so the tests check the real file. */
const realBase = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

describe("braveManifest", () => {
	test("names the build for Brave, in name and description", () => {
		const brave = braveManifest(realBase);
		assert.equal(brave.name, realBase.name.replace("for Chrome", "for Brave"));
		assert.equal(brave.description, realBase.description.replace("for Chrome", "for Brave"));
		assert.match(brave.name, /for Brave$/);
	});

	test("changes nothing else", () => {
		const brave = braveManifest(realBase);
		assert.deepEqual({ ...brave, name: "", description: "" }, { ...realBase, name: "", description: "" });
	});

	test("keeps the key: it is Chrome's pin for the unpacked id", () => {
		assert.ok(realBase.key, "manifest.json should still carry the key");
		assert.equal(braveManifest(realBase).key, realBase.key);
	});

	test("leaves the manifest it reads alone", () => {
		const base = { name: "X for Chrome", description: "for Chrome", permissions: ["tabs"] };
		const brave = braveManifest(base);
		brave.permissions.push("alarms");
		brave.name = "changed";
		assert.deepEqual(base, { name: "X for Chrome", description: "for Chrome", permissions: ["tabs"] });
	});

	test("the committed manifest is a complete MV3 package", () => {
		assert.equal(realBase.manifest_version, 3);
		assert.ok(realBase.permissions.includes("favicon"), "the favicon store needs the permission");
		assert.ok(realBase.background.service_worker);
	});
});
