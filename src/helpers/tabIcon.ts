"use strict";

// Where a tab's tile takes its icon from (popup/views/Tab.tsx).
//
// Normally the browser is asked for its own copy of the page's icon
// (chrome-extension://<id>/_favicon/?pageUrl=…), which answers for every page
// the profile has seen: a discarded tab keeps its icon there, and even a tab
// whose address is still empty has one as soon as Chrome knows the page.
//
// It has nothing at all for the tabs a suspender extension holds. Their address
// is the suspender's own page:
//   chrome-extension://<id>/suspended.html#ttl=…&pos=…&favicon=<data:…>&uri=<page>
// so the browser answers with the suspender's icon for it (and the tab's own
// favIconUrl is that same wrong icon). The Great Suspender and its forks, The
// Marvellous Suspender among them, store the page's own icon and its address in
// that fragment, and these two readers take them from there: the tile then
// shows the icon the page itself has, while it is suspended, while it is being
// restored and when it is restored again.
//
// A suspender that keeps the icon only in its page (not in the address) still
// leaves it on the tab as favIconUrl (a data: url the page set in
// <link rel=icon>): extensionTabIcon() takes it from there, for any address
// that is a chrome-extension:// page, where the favicon store cannot answer.

// The suspenders' page, the only address these parameters are read from. A
// page of its own may carry a "uri" for anything; a browser-internal page never
// goes through here.
const SUSPENDED = /^chrome-extension:\/\/[^/]+\/suspended\.html(?:[?#]|$)/i;
// any extension's own page (a suspender's, or another extension's)
const EXTENSION_PAGE = /^chrome-extension:\/\//i;
// a data: url a favicon can be drawn from
const DATA_IMAGE = /^data:image\//i;
// what the favicon store can answer for
const FAVICON_PAGE = /^(?:https?|file):/i;

/** The fragment and the query of `url`, in the order they appear in it. */
function parts(url : string) : string[] {
	const at = [url.indexOf("#"), url.indexOf("?")].filter((i) => i >= 0).sort((a, b) => a - b);
	return at.map((i, n) => url.slice(i + 1, at[n + 1]));
}

/** The value of the `key=…` pair of the fragment, else of the query, "" when
 *  neither has one. Percent-decoded, but not as a form: a base64 value keeps
 *  the `+` it was written with (a form decoder would turn it into a space). */
function param(url : string, key : string) : string {
	for (const part of parts(url)) {
		for (const pair of part.split("&")) {
			const eq = pair.indexOf("=");
			if (eq < 0 || pair.slice(0, eq).toLowerCase() !== key) continue;
			const value = pair.slice(eq + 1);
			try {
				return decodeURIComponent(value);
			} catch {
				// a broken escape is no reason to lose the value
				return value;
			}
		}
	}
	return "";
}

/** The page's own icon a suspended tab carries (a data: url), "" when it has none. */
export function suspendedTabIcon(url : string) : string {
	if (!SUSPENDED.test(url)) return "";
	const icon = param(url, "favicon");
	return /^data:image\//i.test(icon) ? icon : "";
}

/** The address of the page behind a suspended tab, "" when it carries none. */
export function suspendedTabPage(url : string) : string {
	if (!SUSPENDED.test(url)) return "";
	const page = param(url, "uri") || param(url, "url");
	return FAVICON_PAGE.test(page) ? page : "";
}

/** The icon the tab itself carries (a data: url the suspender page put in
 *  <link rel=icon>) for an address that is a chrome-extension:// page, "" when
 *  it has none. Some suspends keep the icon only in the page, not in the
 *  address, and the browser's favicon store answers for extension pages with
 *  the extension's own icon or nothing at all: neither is the page's icon. */
export function extensionTabIcon(address : string, favIconUrl : string | undefined) : string {
	if (!EXTENSION_PAGE.test(address)) return "";
	return favIconUrl && DATA_IMAGE.test(favIconUrl) ? favIconUrl : "";
}

/** The browser's own favicon for `page`, served by the extension itself (the
 *  "favicon" permission). Chrome and Brave only. */
export function storedFavicon(extensionId : string, page : string) : string {
	return "chrome-extension://" + extensionId + "/_favicon/?pageUrl=" + encodeURIComponent(page) + "&size=64";
}
