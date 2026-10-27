"use strict";

// Unit tests for the tab icon readers in src/helpers/tabIcon.ts.
// Run with: npm test  (== node --test tests/)

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { suspendedTabIcon, suspendedTabPage, storedFavicon, extensionTabIcon } from "../src/helpers/tabIcon.ts";

// The Marvellous Suspender, as its suspended tabs really look: the page's own
// icon and address in the fragment (percent-encoded, as its page is)
const MARVELLOUS = "chrome-extension://noogafoofpebimajpfpamcfhoaiemoja/suspended.html#ttl=Rule%2034&pos=0"
	+ "&favicon=data%3Aimage%2Fpng%3Bbase64%2CiVBORw0KGgoAAAANSUhEUgAA&uri=https%3A%2F%2Frule34.xxx%2Findex.php%3Fq%3D1";

describe("suspendedTabIcon", () => {
	test("reads the page's icon out of a suspended tab's address", () => {
		assert.equal(suspendedTabIcon(MARVELLOUS), "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA");
	});

	test("the icon is read whatever its place among the parameters", () => {
		const url = "chrome-extension://abc/suspended.html#favicon=data%3Aimage%2Fgif%2CAA&ttl=x";
		assert.equal(suspendedTabIcon(url), "data:image/gif,AA");
	});

	test("a value that is not an image has no icon", () => {
		assert.equal(suspendedTabIcon("chrome-extension://abc/suspended.html#favicon=https%3A%2F%2Fx%2Ff.ico"), "");
		assert.equal(suspendedTabIcon("chrome-extension://abc/suspended.html#favicon=data%3Atext%2Fplain%2Cx"), "");
	});

	test("an ordinary page named suspended.html is not a suspender", () => {
		assert.equal(suspendedTabIcon("https://example.com/suspended.html#favicon=data%3Aimage%2Fpng%2CAA"), "");
		assert.equal(suspendedTabIcon("chrome-extension://abc/other.html#favicon=data%3Aimage%2Fpng%2CAA"), "");
	});

	test("no address at all: no icon", () => {
		assert.equal(suspendedTabIcon(""), "");
		assert.equal(suspendedTabIcon(undefined as unknown as string), "");
	});

	test("base64 keeps its +, encoded and raw", () => {
		assert.equal(suspendedTabIcon("chrome-extension://abc/suspended.html#favicon=data%3Aimage%2Fpng%3Bbase64%2CaGVsbG8rd29ybGQ%3D"),
			"data:image/png;base64,aGVsbG8rd29ybGQ=");
		// a raw + must not turn into a space (a form decoder would do that)
		assert.equal(suspendedTabIcon("chrome-extension://abc/suspended.html#favicon=data:image/png;base64,aGVsbG8rd29ybGQ="),
			"data:image/png;base64,aGVsbG8rd29ybGQ=");
	});

	test("a broken escape gives the value as it stands", () => {
		assert.equal(suspendedTabIcon("chrome-extension://abc/suspended.html#favicon=data:image/png,%ZZ"),
			"data:image/png,%ZZ");
		// still encoded all the way: nothing the tile could draw
		assert.equal(suspendedTabIcon("chrome-extension://abc/suspended.html#favicon=data%3Aimage%2Fpng%2C%ZZ"), "");
	});
});

describe("suspendedTabPage", () => {
	test("reads the page's address out of a suspended tab's address", () => {
		assert.equal(suspendedTabPage(MARVELLOUS), "https://rule34.xxx/index.php?q=1");
	});

	test("the address may sit in the query instead", () => {
		assert.equal(suspendedTabPage("chrome-extension://abc/suspended.html?uri=https%3A%2F%2Fexample.com%2Fa"), "https://example.com/a");
		assert.equal(suspendedTabPage("chrome-extension://abc/suspended.html?url=https%3A%2F%2Fexample.com%2Fb"), "https://example.com/b");
	});

	test("uri wins over url", () => {
		const url = "chrome-extension://abc/suspended.html#url=https%3A%2F%2Fa.test%2F&uri=https%3A%2F%2Fb.test%2F";
		assert.equal(suspendedTabPage(url), "https://b.test/");
	});

	test("a file: page counts, everything else does not", () => {
		assert.equal(suspendedTabPage("chrome-extension://abc/suspended.html#uri=file%3A%2F%2F%2FC%3A%2Fx.html"), "file:///C:/x.html");
		assert.equal(suspendedTabPage("chrome-extension://abc/suspended.html#uri=javascript%3Aalert(1)"), "");
		assert.equal(suspendedTabPage("chrome-extension://abc/suspended.html#uri=chrome%3A%2F%2Fsettings%2F"), "");
		assert.equal(suspendedTabPage("chrome-extension://abc/suspended.html#uri=about%3Ablank"), "");
	});

	test("a suspended tab without an address has none to give", () => {
		assert.equal(suspendedTabPage("chrome-extension://abc/suspended.html#ttl=x&pos=0"), "");
		assert.equal(suspendedTabPage("https://example.com/suspended.html#uri=https%3A%2F%2Fx.test%2F"), "");
	});
});

describe("extensionTabIcon", () => {
	// A suspension the Marvellous Suspender made without storing the icon in
	// the address: the suspender page sets it in <link rel=icon> and the tab
	// reports it back as a data: url (tampermonkey.net/documentation.php, 2858 bytes)
	const PAGE_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAA";
	const SUSPENDED_NO_ICON = "chrome-extension://noogafoofpebimajpfpamcfhoaiemoja/suspended.html#ttl=Documentation%20%7C%20Tampermonkey&pos=376&uri=https%3A%2F%2Fwww.tampermonkey.net%2Fdocumentation.php";

	test("takes the tab's own data: icon for an extension page", () => {
		assert.equal(extensionTabIcon(SUSPENDED_NO_ICON, PAGE_ICON), PAGE_ICON);
	});

	test("it does on any chrome-extension page, not just a suspender's", () => {
		assert.equal(extensionTabIcon("chrome-extension://abc/dashboard.html", PAGE_ICON), PAGE_ICON);
	});

	test("a non-image favIconUrl has no icon to take", () => {
		assert.equal(extensionTabIcon(SUSPENDED_NO_ICON, "https://x.test/favicon.ico"), "");
		assert.equal(extensionTabIcon(SUSPENDED_NO_ICON, "chrome-extension://abc/img/icon.png"), "");
		assert.equal(extensionTabIcon(SUSPENDED_NO_ICON, ""), "");
		assert.equal(extensionTabIcon(SUSPENDED_NO_ICON, undefined), "");
	});

	test("an ordinary page's favIconUrl is not taken", () => {
		assert.equal(extensionTabIcon("https://example.com/", PAGE_ICON), "");
		assert.equal(extensionTabIcon("chrome://settings/", PAGE_ICON), "");
	});

	test("address case does not matter", () => {
		assert.equal(extensionTabIcon("CHROME-EXTENSION://abc/suspended.html", PAGE_ICON), PAGE_ICON);
	});
});

describe("storedFavicon", () => {
	test("asks the extension's own favicon store for the page", () => {
		assert.equal(storedFavicon("abc", "https://x.test/a?b=c&d=e"),
			"chrome-extension://abc/_favicon/?pageUrl=" + encodeURIComponent("https://x.test/a?b=c&d=e") + "&size=64");
	});

	test("the browser's own pages go through it unchanged", () => {
		assert.equal(storedFavicon("abc", "chrome://settings/"), "chrome-extension://abc/_favicon/?pageUrl=chrome%3A%2F%2Fsettings%2F&size=64");
	});
});
