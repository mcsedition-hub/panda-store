# SMM

[Documentation](README.md)

Research social content, adapt one to three qualified references to your app, then edit and export the results.

An app can start as an idea. In **My apps → Create a project**, write, paste or
import its Markdown description and choose **Idea** or **In development**. SMM uses
the full saved description, intended audience and separately declared implemented
features. Confirm the scope relevant to the research before starting. Research and
adaptation freeze this version even if you edit the project later. Scripts prepare
finished launch copy: documented features use the present tense, even when the app
is still an idea. Writing and review use the same convention. The internal stage
does not force concept disclaimers or feedback requests into the ads. Production
notes identify footage and screens to supply separately from the spoken and visible
copy. Invented functionality, store availability, testimonials and results remain
excluded. Earlier automatic concept-feedback goals are updated only when creating
new adaptations; saved research and scripts retain their original context.
Demo templates are unavailable for unpublished projects.

## Social research in your browser

**SMM → Research** now uses a local Chrome connector. It is separate from the earlier
server browser, which remains under **Public-page research (legacy)**.

1. Apply migrations and restart the API and workflow worker.
2. Download the connector from SMM, extract it, open `chrome://extensions`, enable
   Developer mode and load the extracted folder. For development, load
   `addons/studio/browser_extension` directly. Return to Panda Store; the connection is detected automatically.
3. Check the app features and audience, choose platforms, performance filters and an
   AI provider/model, then choose **Start social research**. The model prepares search
   queries and the connector opens a dedicated visible tab in your current Chrome profile.
4. Keep Panda Store open. Collection saves up to 12 posts, their observed counters,
   dates, text and up to three viewport frames. An individual post that does not load
   is skipped and its link remains in the activity log. Each collection attempt checks
   at most 24 new posts, then analyzes the saved evidence. Sign-in and verification
   requests still need your attention. A stopped session retains saved evidence. If a platform
   blocks collection, the other platforms can still be checked; the session then pauses.
   Resolve the block and resume, or explicitly choose **Analyze collected posts**.
   **Check connection** verifies the connector before starting or resuming collection.
5. Posts that meet the performance thresholds are marked as awaiting AI review until
   relevance and captured evidence have been checked. Select one to three qualified posts to create
   one original adaptation per selected post, each tied to its own source and observed format.
   Carousels produce slide plans, single images produce a visual brief and caption,
   text posts produce copy, and videos produce filming
   or editing scripts. Drafts stay editable and require separate approval.
   Qualified references from other completed research appear alongside the current posts
   when the app, metadata snapshot, confirmed features, audience and market match.
   Current performance filters are checked again. A repeated URL counts only once;
   each selected source retains its original research session in the generation context.

The default 10,000 video views and 500 likes are editable filters, not a universal
definition of virality. Missing or ambiguous counts cannot pass. Video requires both
views and likes; text/image/carousel requires likes. Relevance and evidence undergo a separate
AI review. At least one qualified reference is required for adaptation; no extra generic examples
are generated to fill a smaller selection. Google discovers posts on the supported social sites.

Connector 0.1.8 reconnects open dashboard tabs automatically after extension installation,
reload/update, or browser startup, preserving the form. Compatible patch versions no
longer require an extension update just to start research; 0.1.7 remains supported.
Unpacked installations still need a manual extension reload to apply new files.
The local ZIP does not provide Chrome Web Store automatic updates.

Connector 0.1.7 and later can verify missing Instagram video views on the creator's Reels grid.
Only the exact post's labelled counter is accepted, with a screenshot and source URL.
The last evidence frame then shows the counter, not another video sample. The lookup
is bounded and pauses for sign-in or verification; unavailable counts remain unknown.
Saved research keeps its original observations. Capture a new search after updating
the connector to use these improvements.

This local alpha supports only the configured localhost dashboard origins. Site layouts
and access restrictions can interrupt collection. The connector samples visible frames;
it does not observe complete videos/carousels or listen to audio. These limits travel
with the evidence and drafts. It never transfers social passwords or cookies. Review
observed counters and product claims before using an adaptation. Publishing and social
account connections are planned for the cloud edition.

Live validation and known limits are recorded in the [roadmap](roadmap.md).

Z.ai (GLM) is supported in browser research with a vision model such as
`glm-4.6v-flash`. Text-only GLM models remain available for script generation.
See [GLM connection and model selection](connections.md#zai-glm).

Run connector checks with `node --test tests/browser_extension.test.mjs`.
See the [connector instructions](../addons/studio/browser_extension/README.md).

## Create scripts from research

For browser research, select one to three qualified posts and choose **Create adaptations**.
One selected post produces one draft, two produce two, and three produce three.
Each draft retains its reference, observed format and confirmed app context.

In **Public-page research (legacy)**, select one to three retained observations and choose **Use observations in brief**.
SMM saves the selection and opens **Scripts**. Define the audience, goal, tone, language and
target duration, then enter the product facts the script may use. Confirm those facts and select
a model from your workspace's OpenAI, Gemini, Claude or Z.ai connection. **Create scripts** runs two
model calls: writing three directions and reviewing their claims, sources and distinctness.

Each generation freezes the selected import, brief, source observations and connection revision.
Research informs structure; it does not authorize copying competitor text or transferring features,
prices or performance claims. Exact product fact quotes and source IDs are checked in code. The
second model review can still miss errors, so scripts require human review before use. A rejected
review withholds the batch of scripts and displays its reasons. Adjust the brief and start a new
generation; retry is for interrupted work, not for repeatedly approving rejected content.

When only the review times out, **Retry unfinished steps** reuses completed writing. No automatic
paid retry or provider switch occurs. Usage is recorded for completed calls; reused steps retain
their original counts and timed-out calls may still be billed. Editing a script clears its approval.
**Research adaptation** preserves the original AI rationale; subsequent human edits are not
automatically rechecked. The Markdown export includes the sources and the confirmed facts.
Social-research exports also preserve each content format, observed counters (including
approximate or missing values), capture dates, research sessions and coverage limits.
Recorded review corrections remain traceable. Target duration applies to video only;
carousel and text adaptations keep their own structure.

These are editable scripts and shooting directions, not generated video files. Target duration is
an estimate. No social account is connected or post published. AI generation works with demo mode
disabled; **Demo templates · No AI** remains a separate optional local mode.

## Plan scenes and prepare an editing package

Open **Scripts → Plan scenes**, or **SMM → Scenes**, and choose a saved script.
**Create storyboard** keeps explicit scene labels and separates the opening and call to action.
Other script formats are preserved in one editable shot. This step makes no model call and does
not approve the script. Adjust shot order, direction, voiceover, on-screen text and duration.

Select an image in **App visuals** to archive and attach one of the connected app's own store
screenshots. Supported imports currently come from Apple's image CDN; competitor research
captures are not offered as production assets. Images retain their aspect ratio in the 9:16
preview. They are store-image derivatives, potentially with marketing text, not raw screen
recordings. Upload PNG, JPEG or WebP images, H.264 MP4 recordings, or MP3, M4A and WAV
audio in the same library. Choose a clip start, attach voiceover audio or keep the recording's
original sound. Attached voiceover replaces recording audio; short audio is padded with silence.
**Play preview** sequences images and recordings silently. Check the rendered MP4 for final
sound and timing. Voiceover text remains a script; it is not synthesized speech.

Save a storyboard before recording. Each save creates a revision; competing edits return a
conflict without overwriting local work. Navigation saves pending edits and stops if saving fails.
A script change is flagged without replacing the shot plan. **Export package** downloads the
selected saved revision with `storyboard.json`, a Markdown shot list and the selected media.
**Save & export** saves the current edits first. The last 100 versions are selectable in the UI;
older saved versions remain available through the versioned export API.

**Render MP4** renders a saved revision as a 1080 × 1920, 30 fps video with on-screen text
and selected audio. Every shot needs an image or recording, and the total must be at most
120 seconds. The workflow shows progress, supports stopping and reuses completed shots on
retry. Preview or download finished videos privately. Deleting an export removes its saved
shots and activity; a render used by a later retry can only be deleted after that retry.

SMM works with ASO disabled. Its private app library stores at most 60 files / 200 MB per
app, with a 25 MB upload limit. Images are normalized to JPEGs of at most 1.5 MB; recordings
are limited to 120 seconds. Renders and saved shots share a 500 MB workspace quota. These
files are stored in the database; include them in backups. Media referenced by any saved
storyboard revision cannot be deleted. Up to 20 shots and ten minutes per plan are supported,
but video exports have the shorter limit above.

Apply migrations and restart the API and worker when upgrading. Install FFmpeg and ffprobe
on both; the Docker image includes them. Voice synthesis and generated video remain to be built.

## Activity and recovery

SMM shows a saved activity log and clickable steps for each new generation.
Closing the page does not stop a server workflow. Browser collection requires the dashboard
to remain open; its saved captures survive interruption. **Stop** requests cooperative cancellation;
**Retry unfinished steps** creates a linked attempt with the original metadata and
brief, reusing completed results. Scripts still require separate approval.
Earlier generations remain available without retroactively invented activity.
Retry also retains the original model and AI connection. After replacing a key or
choosing another model, start a new task. If history, activity or AI connections cannot
be loaded, their reload actions fetch saved state without starting another task.

`PANDA_WORKFLOW_DISPATCH=database` is the local default. Compose sets it to `celery`
and uses its Redis/Celery services instead. A queued workflow with no worker fails
after five minutes when inspected; an interrupted worker's lease expires after
45 seconds. Live clients and the local worker detect expired leases. The current
UI follows sequential SMM and ASO steps. SMM research can search, open and scroll a bounded
set of public pages. Open-ended browser navigation, parallel scheduling and a visual workflow
editor are still planned.

## Creative research

The older **Public-page research (legacy)** panel remains under **SMM → Research**.
For social browser research, follow [Social research in your browser](#social-research-in-your-browser).
In the legacy panel, choose an app, enter a research topic and
market, then explicitly select an OpenAI, Google Gemini or Anthropic Claude model from your
workspace's connections. The selected model must support the provider's web-search tool and
image analysis; unsupported combinations fail explicitly, without switching providers.

For local development, install Chromium in the same Python environment as the worker:

```sh
.venv/bin/python -m playwright install chromium
# On Linux, install the system dependencies too:
.venv/bin/python -m playwright install --with-deps chromium
```

Restart the workflow worker after updating backend code. The Docker image includes Chromium;
Compose runs its non-root worker with the bundled Playwright seccomp profile and shared memory.
Chromium's sandbox must be supported by the host. A launch check runs before paid discovery.
On Ubuntu, the installed Chromium executable may need an AppArmor profile allowing `userns`,
as described in the [Ubuntu documentation](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/).
CI loads a profile for that exact executable; it does not disable Chromium's sandbox or change
system-wide namespace restrictions.

Research uses up to three model calls: web discovery, analysis, and an independent review against
the same saved evidence. Provider search fees are additional. OpenAI/Claude searches are bounded
to three tool calls; Google's requested three-query limit is advisory, not a hard billing cap.
Actual provider usage is retained per completed step. Timeouts may still be billed and never
trigger an automatic paid retry.

The browser opens up to six discovered sources and three cross-domain App Store references
(Duolingo, Spotify and Tinder), scrolls once and saves two page views, bounded text, dates and
content hashes in this installation's database. It uses an ephemeral session without personal
cookies. Private addresses, credentials in URLs, downloads, media playback, form submission,
embedded frames and WebSockets are not available. Site access policies and login/challenge walls
can leave sources unavailable. This is page/still research, not video or audio analysis.

Results separate discovered links, captured pages, reviewed observations and withheld claims.
Visible metrics retain their exact quoted labels; no popularity score, install attribution or
performance guarantee is inferred. The three large apps are structural references, not assumed
niche competitors. Every session exposes its actual coverage, including missing references.
The research inputs and saved evidence are immutable. **Retry unfinished steps** reuses completed
work; **Retry unavailable sources** keeps the search and readable pages and creates a new attempt
for the missing pages, without changing the original report. Analysis/review calls may run again.

Full video analysis remains a later improvement. The community browser connector supports
research in the user's signed-in browser; social account connections for publication and
scheduling are reserved for the future cloud edition.
