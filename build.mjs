// Builds a complete, loadable extension folder per browser with esbuild.
//
//   node build.mjs             production Chrome  -> build/chrome
//   node build.mjs --brave     production Brave   -> build/brave
//   node build.mjs --all       both folders       -> build/chrome and build/brave
//   node build.mjs --version 7.1.0   the version to build (skips the question)
//   node build.mjs --dev       development: readable output, source maps
//   node build.mjs --watch     development + rebuild on change (bundle and static files)
//   node build.mjs --devtools  dev only, Chrome only: adds the localhost CSP that
//                              React DevTools (`npx react-devtools`) needs to connect
//
// A build run on a terminal first asks which version the extension should be
// (scripts/buildVersion.mjs): the answer goes into the built manifest.json and
// into the popup bundles, so the extension card and the options page show it.
// The files in the repo keep the committed version, so a build of one's own
// needs no commit and `npm run check-version` keeps passing. Enter keeps the
// committed version; CI, a pipe and --watch are not asked at all.
//
// A folder holds everything the browser needs: the manifest, the four
// html pages, css/popup.css (the stylesheet bundle, see scripts/css.mjs), images/, fonts/,
// dist/ (the esbuild output; it keeps that subpath so the <script src="dist/…">
// references in the html files stay as they are), features/ (the changelog clips, when present) and the two legal documents. Load build/chrome unpacked in Chrome
// and build/brave in Brave. readme.md and CHANGELOG.md stay out: the stores want
// the extension, not its documentation.
//
// The service worker is bundled first, on its own. Its version is a hash of the
// bytes that bundle came out as, so it changes only when worker code (or code
// bundled into it) changes, never on a plain rebuild. The version is appended to
// the written worker file and baked into the popup and options bundles, which ask
// the worker for it after rendering and say so when it is not the one they were
// built for (an extension rebuilt but not reloaded). See scripts/bundle.mjs.
//
// The browser is a compile-time constant: IS_CHROME is replaced by true/false
// before bundling, and IS_FIREFOX by a constant false, since this fork builds
// Chrome and Brave only.
//
// manifest.json is the complete Chrome manifest and the single source of truth;
// Brave gets it renamed, see scripts/manifest.mjs. The committed manifest.json
// must never carry the --devtools policy; the check below refuses to build if it does.
//
// Brave runs Chromium, often an older one than Chrome stable (1.84 ships 142),
// so it gets a folder of its own to load. The code is the same; the compatibility
// work lives in the shared sources and the conservative esbuild target (chrome104),
// never behind a Brave-only branch.
//
// npm scripts: build (prod Chrome and Brave, one question for both folders),
// build:chrome, build:brave, build:dev, watch and watch:dev.

import * as esbuild from 'esbuild'
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync, statSync, watch as watchPath } from 'node:fs'
import { dirname, join } from 'node:path'
import { braveManifest } from './scripts/manifest.mjs'
import { cssOptions } from './scripts/css.mjs'
import { workerOptions, appOptions, stampWorkerOutputs } from './scripts/bundle.mjs'
import { askVersion, versionOption, versionProblem } from './scripts/buildVersion.mjs'

const argv = process.argv.slice(2)
const args = new Set(argv)
const watch = args.has('--watch')
const dev = watch || args.has('--dev')
const devtools = args.has('--devtools')

// copied verbatim next to the manifest; directories go in whole. css/ is not
// here: the stylesheet is bundled (below), the raw files under css/ never ship
const STATIC = ['popup.html', 'options.html', 'changelog.html', 'documentation.html', 'images', 'fonts', 'LICENSE.md', 'PRIVACY.md']

// features/<version>/ holds the clips of the changelog page (changelog.html shows them,
// see scripts/changelog.mjs), whole, as the stores zip build/<browser>. It is copied when it
// exists, since a clip that is not shipped is simply hidden by the page; brag-output*
// (the render workspace) is a different folder and never ships
const OPTIONAL_STATIC = ['features']

// the sources watch mode keeps an eye on: the static files plus the manifest
// (css/ is watched by the esbuild context of the stylesheet bundle)
const WATCHED = ['popup.html', 'options.html', 'changelog.html', 'documentation.html', 'images', 'fonts', 'features', 'manifest.json']

// React DevTools talks to the page over a websocket on 8097; only a dev build
// may allow it, and only Chrome needs a policy for it at all
const DEVTOOLS_CSP = { extension_pages: "script-src 'self' http://localhost:8097; object-src 'self'" }

function fail(message) {
	console.error(message)
	process.exit(1)
}

// Chrome and Brave only (readme.md). Refused loudly: a stale --firefox would
// otherwise quietly write a Chrome build into build/chrome.
if (args.has('--firefox')) fail('--firefox: this fork builds Chrome and Brave only (see readme.md)')

// Chrome is the default, --brave is the folder of its own, --all is both from
// one run (and so from one version question; npm run build)
const browsers = args.has('--all') ? ['chrome', 'brave'] : [args.has('--brave') ? 'brave' : 'chrome']

// the version the repo carries; a build may carry another one (below)
const sourceVersion = JSON.parse(readFileSync('package.json', 'utf8')).version

/**
 * The version this build carries: `--version 7.1.0`, else the answer to the
 * question a terminal gets, else the repo's own (see scripts/buildVersion.mjs).
 */
async function buildVersion() {
	const asked = versionOption(argv)
	if (asked !== undefined) {
		const problem = versionProblem(asked)
		if (problem) fail('--version: ' + problem)
		return asked
	}
	// a watch build is the loop one leaves running: it asks nothing
	return watch ? sourceVersion : askVersion(sourceVersion)
}

const version = await buildVersion()
if (version !== sourceVersion) console.log(`building ${version}; the files in the repo stay at ${sourceVersion}`)

/** One complete, loadable extension folder for one browser. */
async function buildBrowser(browser) {
	const outDir = join('build', browser)

	// The service worker is built first and on its own: its version is a hash of
	// what it came out as, and the popup bundles are built to require that version
	// (see scripts/bundle.mjs). A rebuild without a change in worker code gives the
	// same version, so the popup raises no "reload the extension" notice for it.
	const bundleBase = { browser, dev, outDir, version }

	/** Writes the worker's in-memory build with its version line added; returns the version. */
	function writeWorker(result) {
		const { version: workerVersion, files } = stampWorkerOutputs(result.outputFiles)
		for (const file of files) {
			mkdirSync(dirname(file.path), { recursive: true })
			writeFileSync(file.path, file.contents)
		}
		return workerVersion
	}

	/** The stylesheet bundle: css/popup.css and its imports -> build/<browser>/css/popup.css */
	const css = cssOptions({ outfile: join(outDir, 'css', 'popup.css'), dev })

	/** Writes build/<browser>/manifest.json from manifest.json (renamed for Brave). */
	function writeManifest() {
		const base = JSON.parse(readFileSync('manifest.json', 'utf8'))

		// the development policy is injected below, never committed: with it in
		// manifest.json the store would reject the package
		if (JSON.stringify(base.content_security_policy ?? null).includes('localhost')) {
			fail('manifest.json carries a content_security_policy that mentions localhost. That belongs in a --devtools development build only; remove it from the committed manifest.')
		}

		let manifest = base
		if (browser === 'brave') {
			manifest = braveManifest(base)
		} else if (dev && devtools) {
			manifest = { ...base, content_security_policy: DEVTOOLS_CSP }
		}

		// the built extension carries this build's version; the manifest.json in
		// the repo keeps the committed one (see the header)
		writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ ...manifest, version }, null, '\t') + '\n')
	}

	/** Copies one static source, file or directory, into the output folder. */
	function copy(path) {
		const dest = join(outDir, path)
		mkdirSync(dirname(dest), { recursive: true })
		cpSync(path, dest, { recursive: true })
	}

	function copyStatic() {
		for (const path of STATIC) copy(path)
		for (const path of OPTIONAL_STATIC) if (existsSync(path)) copy(path)
	}

	if (devtools && browser !== 'chrome') console.log('--devtools only applies to Chrome, ignoring it')
	if (devtools && !dev) console.log('--devtools only applies to a development build, ignoring it')

	// esbuild never deletes old output, and a stale manifest or image would ship
	// with the next package, so the folder starts empty every time
	rmSync(outDir, { recursive: true, force: true })
	mkdirSync(outDir, { recursive: true })
	copyStatic()
	writeManifest()

	if (watch) {
		// the worker's context rewrites the worker on every build; when its version
		// changed, the popup bundles are rebuilt for the new one (their define is fixed
		// per context, so that context is replaced)
		let workerVersion = writeWorker(await esbuild.build(workerOptions(bundleBase)))
		let appCtx = null
		async function startApp() {
			await appCtx?.dispose()
			appCtx = await esbuild.context(appOptions({ ...bundleBase, workerVersion }))
			await appCtx.watch()
		}
		await startApp()
		const workerCtx = await esbuild.context({
			...workerOptions(bundleBase),
			plugins: [{
				name: 'worker-version',
				setup(build) {
					build.onEnd(async (result) => {
						if (result.errors.length > 0 || !result.outputFiles) return
						const next = writeWorker(result)
						if (next === workerVersion) return
						workerVersion = next
						console.log(`service worker changed (${next}), rebuilding the popup bundles`)
						await startApp()
					})
				},
			}],
		})
		await workerCtx.watch()
		// a second context for the stylesheet: rebuilds on any change under css/
		const cssCtx = await esbuild.context(css)
		await cssCtx.watch()

		// one watcher per watched directory, recursively (Node 22+ can do that on
		// Windows and Linux), plus one on the repo root for the watched files:
		// editors that rewrite a file in place break a watcher on the file itself
		const dirs = WATCHED.filter((source) => existsSync(source) && statSync(source).isDirectory())
		const files = new Set(WATCHED.filter((source) => !dirs.includes(source)))

		const pending = new Set()
		let timer = null

		function changed(path) {
			pending.add(path)
			clearTimeout(timer)
			// a save often arrives as several events; wait for them to stop
			timer = setTimeout(flush, 50)
		}

		function flush() {
			for (const path of pending) {
				try {
					if (path === 'manifest.json') {
						writeManifest()
						console.log(`merged ${path} -> ${join(outDir, 'manifest.json')}`)
					} else if (existsSync(path)) {
						copy(path)
						console.log(`copied ${path} -> ${join(outDir, path)}`)
					} else {
						rmSync(join(outDir, path), { recursive: true, force: true })
						console.log(`removed ${join(outDir, path)}`)
					}
				} catch (error) {
					console.error(`could not update ${path}: ${error.message}`)
				}
			}
			pending.clear()
		}

		/** fs.watch reports a native path; the rest of this file speaks posix. */
		const posix = (name) => name.split('\\').join('/')

		for (const dir of dirs) {
			watchPath(dir, { recursive: true }, (_event, name) => {
				if (name) changed(`${dir}/${posix(name)}`)
			})
		}
		watchPath('.', (_event, name) => {
			if (name && files.has(posix(name))) changed(posix(name))
		})

		console.log(`watching ${outDir} (${version}, development)…`)
		return
	}

	const workerVersion = writeWorker(await esbuild.build(workerOptions(bundleBase)))
	await Promise.all([esbuild.build(appOptions({ ...bundleBase, workerVersion })), esbuild.build(css)])
	console.log(`built ${version} for ${browser} into ${outDir} (${dev ? 'development' : 'production'}), service worker ${workerVersion}`)
}

for (const browser of browsers) await buildBrowser(browser)
