# Panda SMM Browser (local alpha)

[SMM guide](../../../docs/smm.md) · [Installation](../../../docs/installation.md)

## Install

1. Extract this ZIP. In Chrome, open `chrome://extensions`.
2. Enable Developer mode, choose **Load unpacked**, and select the `panda-smm` folder.
3. Return to Panda Store at `http://127.0.0.1:5173` (development or Docker Compose)
   and open SMM → Research. The connection is detected automatically.

## Update and reconnect

Current version: **0.1.11**, protocol **1**. Replace the installed folder with this download, click **Reload**
for Panda SMM Browser in `chrome://extensions`. If you loaded
`addons/studio/browser_extension` directly from the project, only the reload is needed.
Version 0.1.11 checks for a missing dashboard bridge when its service worker starts,
when you return to a tab or Chrome window, and after navigation, as well as installation
and browser startup. Healthy bridges are left intact. The dashboard checks the connection
every 45 seconds while visible, retries failed checks after 10 seconds, and checks on
focus or network recovery. Only the harmless connection check is automatically repeated;
a failed research command is paused for explicit resumption. The form is preserved.
The connected version appears in SMM, with update instructions for older releases.
Version 0.1.7 remains compatible, but may require a
dashboard refresh after reloading the extension. Protocol compatibility is checked
independently of the patch version, so compatible updates do not block research.
Unpacked installations still require replacing files and reloading the extension to
apply code changes. Automatic distribution updates require a Chrome Web Store release;
the local ZIP is not such a release. If the connection is missing, open **Connection
instructions** in SMM, check the extension is enabled, then use **Check connection**.
These checks do not start or repeat research. A disabled extension, a different Chrome
profile or revoked site access must still be corrected in Chrome. Reloading a folder
installation is needed once per code update, not as a routine reconnection step.

## Collect evidence

The connector opens its own visible research tab in your current Chrome profile.
Sign in to social sites yourself if required, then resume from Panda Store. Keep the
Panda Store tab open during collection. Closing it stops collection; saved captures
remain on your server and can be resumed. No social passwords or cookies are exported.

Instagram videos with missing views are checked on the creator's Reels grid. The connector
matches the exact post shortcode and labelled view counter, saves its screenshot as
the last of at most three evidence frames, then returns to the post. The lookup is
bounded; missing, hidden or inaccessible counters remain unknown. Single static images
are recognized and evaluated on likes, like carousels and text posts. Author and date
extraction matches Instagram's `/p/` and `/reel/` aliases for the same post.
Existing research keeps its original observations; run a new search to capture updated evidence.
The connector preserves an already open research page when resuming and waits for
transient platform errors within the existing loading timeout. Sign-in and verification
requests still pause collection immediately. Facebook Reel evidence is scoped to the
active video so preloaded neighbouring videos cannot supply its counters.
Version 0.1.9 recognizes loaded Facebook photo attachments as images or galleries,
excluding avatars and comment attachments. These use the likes-only filter rather
than requiring video views. Reel comment and share controls are also supported in
French and English. Aggregate Facebook reactions are not treated as likes, and an
unobserved view count remains unknown. Saved sessions retain their original evidence.
Version 0.1.10 revisits the media and engagement areas within a static Facebook post,
with at most three short reads per area to wait for controls loaded after the caption.
It keeps at most three evidence frames, identifying the engagement screenshot separately
from the post media. Additional counters require a successful evidence capture and a
matching post URL. It does not scroll the Reels feed or click reaction controls.

Search waits for actual result links after the page shell loads. Missing results and
platform blocks are recorded in the session history; other networks can continue.
Instagram/Facebook counts are read from labelled post controls, excluding captions and
comment lists. Missing counters remain unknown. Facebook search hides some permalinks
until a timestamp is opened. The connector uses browser input to open up to three public
post timestamps per query, records their direct URLs, then closes each post dialog.
Named-page `/posts/` links and `permalink.php` links with a page ID and story ID are
supported. Both identifiers are retained when comparing and saving a post.
Targets must be visible and unobscured. Private/group results and engagement controls
are excluded. Native social searches use plain keywords; Google operators stay on Google.
Instagram modal and direct-open layouts are supported. Numeric controls are paired
with their labelled icons; publication dates are tied to the post permalink, not a
comment. A carousel containing video stays a carousel. Empty readings after a document
replacement are retried within the same destination. The dashboard alternates networks
within the twelve-post budget. Videos without qualifying views are rejected before AI analysis.

Collection saves up to 12 posts and examines at most 24 new candidates per attempt,
with up to three viewport samples per post. Counters may be missing or rounded.
Audio and complete videos/carousels are not captured; coverage is saved with each post
and used by the analysis. Site changes and access restrictions can interrupt collection;
no anti-bot or sign-in bypass is attempted. Resolve a verification in the research tab,
then resume, or choose **Analyze collected posts** to finish with the saved evidence.

## Permissions and supported origins

Permissions: scripting reconnects the bridge on allowed local dashboard origins and reads posts on TikTok, Instagram, Facebook and Google; session
storage remembers the connector-owned tab; debugger captures that tab's viewport for
visual analysis and sends pointer input to public Facebook post dates and their dialog
close controls. A Chrome debugging banner may appear. Commands are fixed (search,
read, public post navigation, scroll, next carousel slide, screenshot, stop), never
arbitrary remote code. Pointer coordinates come from the scoped DOM collector, never
from dashboard command arguments.
The connector does not like, follow, comment, message, upload or publish anything.

Only localhost/127.0.0.1 dashboard ports 5173, 8000 and 8080 can invoke it. A hosted deployment
must explicitly add its trusted dashboard origin to `urls.js`, `bridge.js` and the
manifest's host permissions and content-script match list; do not use a wildcard dashboard origin.

Run the connector checks from the repository root with
`node --test tests/browser_extension.test.mjs`.
