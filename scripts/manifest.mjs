// manifest.json is the complete Chrome manifest and the only source of truth in
// the repo. Brave runs the same MV3 package, so its manifest is that file with
// the name and description swapped (braveManifest below); the reason Brave gets
// a folder of its own is its Chromium version, not a different manifest.
//
// The version is never touched here: it comes from manifest.json, which
// scripts/sync-version.mjs keeps in step with package.json.

/**
 * The Brave manifest: the Chrome manifest, named for Brave. Brave ships an
 * older Chromium than Chrome stable, so it gets its own build folder
 * (see build.mjs).
 */
export function braveManifest(base) {
	const manifest = structuredClone(base);
	manifest.name = base.name.replace("for Chrome", "for Brave");
	manifest.description = base.description.replace("for Chrome", "for Brave");
	return manifest;
}
