/* Google Analytics, loaded from a file rather than pasted inline into every
   page. Two reasons: the measurement ID lives in one place, and neither page
   needs 'unsafe-inline' in its script-src to run it — the résumé page has no
   inline script at all and this keeps it that way.

   This runs alongside the self-hosted Umami on analytics.bastamasta.dev. Two
   trackers on one source disagree by design — GA drops what ad blockers eat,
   Umami counts it — and the gap between them is the point.

   Note: gtag writes its _ga_* cookie with a duplicate `expires` attribute,
   which Firefox reports as "the value of the attribute expires has been
   overwritten". That warning comes from Google's own cookie writer; nothing on
   this side can silence it, so it is expected in the console. */
const GA_ID = 'G-ETD1YNN5NE';

const tag = document.createElement('script');
tag.async = true;
tag.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
document.head.append(tag);

window.dataLayer = window.dataLayer || [];
function gtag() { window.dataLayer.push(arguments); }
window.gtag = gtag;
gtag('js', new Date());
gtag('config', GA_ID);
