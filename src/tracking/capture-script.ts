// The inline script the root layout puts in <head>. It posts to /api/visit only when the URL carries a campaign or click ID
// parameter or the visitor came from another site; the Worker sets the first-party cookie. Plain ES2017 in a string.
// Design: docs/superpowers/specs/2026-11-27-ad-tracking-design.md ("Source capture").
export const CAPTURE_SCRIPT = `(function(){try{
var keys=["utm_source","utm_medium","utm_campaign","utm_content","utm_term","gclid","gbraid","wbraid","fbclid","msclkid"];
var tagged=false;
new URLSearchParams(location.search).forEach(function(v,k){if(keys.indexOf(k)!==-1)tagged=true});
var external=false;
if(document.referrer){try{external=new URL(document.referrer).host!==location.host}catch(e){}}
if(!tagged&&!external)return;
var sent=fetch("/api/visit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:location.pathname+location.search,referrer:document.referrer}),keepalive:true,credentials:"same-origin"});
if(sent&&sent.catch)sent.catch(function(){});
}catch(e){}})();`;
