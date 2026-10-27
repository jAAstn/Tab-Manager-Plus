// The version a build carries (build.mjs).
//
// The version in the repo is the one `npm run check-version` keeps in step with
// package.json. A build may carry another one: `--version 7.1.0`, or the answer
// to the question a build asks on a terminal. Nothing in the repo is written by
// that, so a local build with a version of its own needs no commit and leaves
// the version checks alone.

import { createInterface } from 'node:readline/promises'

// What the stores accept: one to four dot-separated integers, each 0-65535 and
// a non-zero one without a leading zero (Chrome's rule; Firefox takes the same)
const VERSION = /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/
const MAX_PART = 65535

/** "" when `value` is a version the browsers take, else why they do not. */
export function versionProblem(value) {
	if (!VERSION.test(value)) return `"${value}" is not a version: one to four numbers, like 7.1.0`
	const tooBig = value.split(".").find((part) => Number(part) > MAX_PART)
	return tooBig ? `"${value}" has a number above ${MAX_PART}` : ""
}

/**
 * The version `--version` asks for: undefined without the flag, "" when it has
 * no value of its own, else the value.
 */
export function versionOption(argv) {
	const at = argv.findIndex((arg) => arg === "--version" || arg.startsWith("--version="))
	if (at < 0) return undefined
	const arg = argv[at]
	if (arg !== "--version") return arg.slice("--version=".length)
	const next = argv[at + 1]
	return next && !next.startsWith("--") ? next : ""
}

/**
 * Asks which version the build should carry. An empty answer keeps `current`,
 * and so does a build with no terminal (CI, a pipe, --watch): an unattended
 * build never waits. `input`/`output` are the terminal to ask on.
 */
export async function askVersion(current, { input = process.stdin, output = process.stdout } = {}) {
	if (!input.isTTY) return current
	const rl = createInterface({ input, output })
	// the input can end with the question still open (Ctrl+D, the end of a
	// pipe): that is no version, so the build keeps the one in the repo
	const gone = new Promise((done) => rl.once("close", () => done(null)))
	try {
		for (;;) {
			const asking = rl.question(`Which version should the built extension be? [${current}] `).catch(() => null)
			const answer = await Promise.race([asking, gone])
			if (answer === null) return current
			const value = String(answer).trim()
			if (!value) return current
			const problem = versionProblem(value)
			if (!problem) return value
			output.write(problem + "\n")
		}
	} finally {
		rl.close()
	}
}
