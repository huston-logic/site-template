// The inline script the root layout puts in <head>. It posts to /api/visit only when the URL carries a campaign or click ID
// parameter or the visitor came from another site; the Worker sets the first-party cookie. Plain ES2017 in a string.
// Design: docs/superpowers/specs/2026-11-27-ad-tracking-design.md ("Source capture").
// Kept as small as it is on purpose: the root layout's prefetch data must stay under Next's 2 KB (gzipped) inlining
// limit, or every page fetches one more file. capture-script.test.ts checks the size.
export const CAPTURE_SCRIPT = `(function(){try{var l=location,r=document.referrer,x=!1;try{x=!!r&&new URL(r).host!==l.host}catch(e){}if(/[?&](utm_(source|medium|campaign|content|term)|gclid|gbraid|wbraid|fbclid|msclkid)=/.test(l.search)||x)fetch("/api/visit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:l.pathname+l.search,referrer:r}),keepalive:!0}).catch(function(){})}catch(e){}})();`;
