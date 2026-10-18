# Panda SMM Browser (local alpha)

1. Extract this ZIP. In Chrome, open `chrome://extensions`.
2. Enable Developer mode, choose **Load unpacked**, and select the `panda-smm` folder.
3. Return to Panda Store at `http://127.0.0.1:5173` (development) or
   `http://localhost:8080` (Docker Compose) and open SMM → Research. The connection is detected automatically.

Updating to **0.1.8**: replace the installed folder with this download, click **Reload**
for Panda SMM Browser in `chrome://extensions`. If you loaded
`addons/studio/browser_extension` directly from the project, only the reload is needed.
Version 0.1.8 reconnects already open dashboard tabs after installation, an extension
reload/update, or browser startup. It preserves the dashboard form and never restarts
a research command automatically. Version 0.1.7 remains compatible, but may require a
dashboard refresh after reloading the extension. Protocol compatibility is checked
independently of the patch version, so compatible updates do not block research.
Unpacked installations still require replacing files and reloading the extension to
apply code changes. Automatic distribution updates require a Chrome Web Store release;
the local ZIP is not such a release.
Version 0.1.7 checks missing Instagram video views on the creator's Reels grid. It
matches the exact post shortcode and labelled view counter, saves its screenshot as
the last of at most three evidence frames, then returns to the post. The lookup is
bounded; missing, hidden or inaccessible counters remain unknown. Single static images
are recognized and evaluated on likes, like carousels and text posts. Author and date
extraction now also matches Instagram's `/p/` and `/reel/` aliases for the same post.
Existing research keeps its original observations; run a new search to capture updated evidence.
Version 0.1.6 preserves an already open research page when resuming and waits for
transient platform errors within the existing loading timeout. Sign-in and verification
requests still pause collection immediately. Both development and Compose dashboards
support version 0.1.7 and protocol 1 connectors. Version 0.1.5 fixed Facebook Reel closing when the banner covers
the dialog control and scoped evidence to the active video so preloaded neighbouring
videos cannot supply its counters.
Version 0.1.4 added the Compose dashboard on port 8080.

Search waits for actual result links after the page shell loads. Missing results and
platform blocks are recorded in the session history; other networks can continue.
Instagram/Facebook counts are read from labelled post controls, excluding captions and
comment lists. Missing counters remain unknown. Facebook search hides some permalinks
until a timestamp is opened. Version 0.1.3 uses browser input to open up to three public
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

The connector opens its own visible research tab in your current Chrome profile.
Sign in to social sites yourself if required, then resume from Panda Store. Keep the
Panda Store tab open during collection. Closing it stops collection; saved captures
remain on your server and can be resumed. No social passwords or cookies are exported.

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

Collection is bounded to 12 posts, with up to three viewport samples each. Counters
may be missing or rounded. Audio and complete videos/carousels are not captured;
coverage is saved with each post and used by the analysis. Site changes and access
restrictions can interrupt collection; no anti-bot or sign-in bypass is attempted.
