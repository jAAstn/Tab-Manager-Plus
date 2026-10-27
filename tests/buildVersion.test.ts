"use strict";

// Unit tests for scripts/buildVersion.mjs: the version a build carries, from
// `--version` or from the question a terminal gets.
// Run with: npm test  (== node --test tests/)

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Readable, Writable } from "node:stream";
import { askVersion, versionOption, versionProblem } from "../scripts/buildVersion.mjs";

/** A terminal that types the given lines: every question (and every refusal)
 *  written to it is taken as the moment the next line is typed. */
function terminal(lines : string[]) {
	const input = new PassThrough() as PassThrough & { isTTY? : boolean };
	input.isTTY = true;
	const said : string[] = [];
	const output = new Writable({
		write: (chunk : unknown, _enc : string, done : () => void) => {
			said.push(String(chunk));
			// a tick later, so the question after a refusal is registered first;
			// a line typed before that would have nobody to answer
			if (lines.length) setImmediate(() => input.write(lines.shift() + "\n"));
			done();
		},
	});
	return { input, output, text: () => said.join("") };
}

/** What a terminal without a prompt was told. */
function report() {
	const chunks : string[] = [];
	const output = new Writable({ write: (chunk : unknown, _enc : string, done : () => void) => { chunks.push(String(chunk)); done(); } });
	return { output, text: () => chunks.join("") };
}

describe("versionProblem", () => {
	test("takes the versions the stores take", () => {
		for (const value of ["7", "7.1", "7.1.0", "7.1.0.5", "0.0.1", "65535.0"]) {
			assert.equal(versionProblem(value), "", value);
		}
	});

	test("refuses anything else, and says what is wrong", () => {
		for (const value of ["", " ", "v7.1.0", "7.1.x", "7.1.0.5.6", "7.1.", ".7", "7..1"]) {
			assert.match(versionProblem(value), /is not a version/, value);
		}
	});

	test("refuses a leading zero, which Chrome refuses too", () => {
		assert.match(versionProblem("7.01"), /is not a version/);
		assert.equal(versionProblem("7.0.10"), "");
	});

	test("refuses a number above 65535", () => {
		assert.match(versionProblem("7.65536"), /above 65535/);
		assert.equal(versionProblem("7.65535"), "");
	});
});

describe("versionOption", () => {
	test("no flag: the build asks", () => {
		assert.equal(versionOption(["--all"]), undefined);
		assert.equal(versionOption([]), undefined);
	});

	test("the value after the flag, or the one in --version=…", () => {
		assert.equal(versionOption(["--all", "--version", "7.1.0"]), "7.1.0");
		assert.equal(versionOption(["--version=7.1.0"]), "7.1.0");
	});

	test("a flag without a value is an empty version, not none at all", () => {
		assert.equal(versionOption(["--version"]), "");
		assert.equal(versionOption(["--version", "--brave"]), "");
	});
});

describe("askVersion", () => {
	test("the answer is the version", async () => {
		assert.equal(await askVersion("7.0.0", terminal(["7.1.0"])), "7.1.0");
	});

	test("an empty answer keeps the version in the repo", async () => {
		assert.equal(await askVersion("7.0.0", terminal([""])), "7.0.0");
	});

	test("surrounding blanks do not matter", async () => {
		assert.equal(await askVersion("7.0.0", terminal(["  7.2.0  "])), "7.2.0");
	});

	test("a wrong answer is refused, and it asks again", async () => {
		const t = terminal(["nope", "7.1.0"]);
		assert.equal(await askVersion("7.0.0", t), "7.1.0");
		assert.match(t.text(), /"nope" is not a version/);
	});

	test("it says which version it offers", async () => {
		const t = terminal([""]);
		await askVersion("7.0.0", t);
		assert.match(t.text(), /\[7\.0\.0\]/);
	});

	test("a terminal that goes away keeps the version in the repo", async () => {
		const t = terminal([]);
		const answering = askVersion("7.0.0", t);
		t.input.end();   // Ctrl+D while the question is open
		assert.equal(await answering, "7.0.0");
	});

	test("without a terminal nothing is asked", async () => {
		const input = Readable.from(["7.1.0\n"]);   // no isTTY: CI, a pipe, npm run build > log
		assert.equal(await askVersion("7.0.0", { input, output: report().output }), "7.0.0");
	});
});
