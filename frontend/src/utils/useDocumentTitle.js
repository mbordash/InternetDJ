import { useEffect } from 'react';

export const SITE_NAME = 'InternetDJ';

/**
 * Set the browser tab title.
 *
 * Writes `document.title` directly rather than going through react-helmet-async,
 * because Helmet is inert in this app. Nothing in the document head carries
 * `data-rh`, no `<Helmet>` title has ever applied, and the Google Ads tag that
 * App.js renders through it has never loaded. A MutationObserver on the head
 * plus a setter trap on `document.title` recorded zero writes across a full
 * load and a client-side navigation, in development and on production alike.
 * Every per-page `<Helmet>` block is decorative on the client today.
 *
 * The tab title should not wait on that. The symptom was bad out of proportion
 * to the cause: the title only ever came from index.html, so with several tabs
 * open none of them could be told apart, and a tab opened on a song kept that
 * song's name five navigations later.
 *
 * Search engines are unaffected either way. Crawlers never see Helmet's output;
 * middleware/ogMetaTags.js detects them and injects a real title, description
 * and canonical into the served HTML before React is involved at all.
 *
 * Pass a falsy value to do nothing, which is what a page should do while its
 * data is still loading: RouteTitle in App.js has already set a sensible title
 * for the route, and this hook takes over once there is something better to
 * say. Effects belonging to a page run before the effect in RouteTitle above
 * it, so a page must not set a title synchronously on mount and expect it to
 * survive; titles derived from fetched data arrive later and win, which is the
 * only case any page here actually needs.
 */
export default function useDocumentTitle(title) {
    useEffect(() => {
        if (!title) return;
        document.title = title === SITE_NAME ? title : `${title} | ${SITE_NAME}`;
    }, [title]);
}
