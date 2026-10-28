// Every page on the site, as data. Each one renders twice: as HTML for people
// and as Markdown for agents (the same URL with `Accept: text/markdown`, or the
// `.md` file beside it). Inline text may use [links](/path) and **bold**.

const REPO = "https://github.com/dqships/clipcat";
const DOWNLOAD = `${REPO}/releases/latest/download`;

export const SITE = {
  name: "ClipCat",
  repo: REPO,
  issues: `${REPO}/issues`,
  releases: `${REPO}/releases`,
  mac: `${DOWNLOAD}/ClipCat-arm64.dmg`,
  macIntel: `${DOWNLOAD}/ClipCat-x64.dmg`,
  windows: `${DOWNLOAD}/ClipCat-x64-Setup.exe`,
  tagline: "Raw takes in, finished video out: a free AI video editor for talking-head videos.",
};

/** When the pages last changed in substance, for the sitemap. */
const UPDATED = "2026-10-28";

export const PAGES = [
  {
    path: "/",
    nav: "Home",
    title: "ClipCat: a free AI video editor for Mac and Windows",
    description:
      "ClipCat turns raw talking-head recordings into an edited video, shorts and a write-up, on your computer, with the Claude or Codex plan you already have.",
    kicker: "AI video editor for Mac and Windows. Free.",
    h1: "Raw takes in. Finished video out.",
    lede:
      "Drop in your recordings. ClipCat makes the first edit with your own Claude or Codex: retakes and pauses out, punch-ins, b-roll, motion slides, sound and captions. Then it cuts the shorts and writes the chapters. You review every change, and it all runs on your computer.",
    hero: true,
    updated: UPDATED,
    sections: [
      {
        kind: "timeline",
        caption:
          "An example of the first edit ClipCat proposes for seven takes. Yellow marks are cuts. Every change comes with a reason, and you can undo any of them.",
      },
      {
        h2: "From raw takes to posted in three steps",
        steps: [
          {
            title: "Record or import",
            text: "Drag in the files from your camera or phone, or record your camera, your screen or just your voice straight into a project.",
          },
          {
            title: "Get a first edit",
            text: "ClipCat transcribes on your computer. Then your Claude or Codex proposes the cuts, zooms, b-roll, slides and sounds, each with a reason.",
          },
          {
            title: "Review and export",
            text: "Accept or reject each change, or edit the transcript like a document. Export the long video, the shorts and the write-up.",
          },
        ],
      },
      {
        kind: "features",
        h2: "Everything in the first edit",
        body: ["Each change lands on its own track, so you can see it, adjust it or turn it off."],
        cards: [
          { track: "A1", title: "Retakes and pauses out", text: "Repeated lines, stumbles and dead air are marked with a reason. Nothing is cut until you accept it." },
          { track: "V1", title: "Punch-ins", text: "A snap, a quick push or a slow creep toward you, to land the lines that matter." },
          { track: "V2", title: "B-roll from your files", text: "Your own screenshots and clips, placed where you talk about them, full frame or picture in picture." },
          { track: "V3", title: "Motion slides", text: "Animated title, list and number cards, designed for the moment and timed to your words." },
          { track: "A2", title: "Sound and music", text: "Effects on the right word, and a music bed that ducks while you talk." },
          { track: "T1", title: "Captions", text: "Burned in a word or a sentence at a time, plus an .srt file beside every export." },
          { track: "9:16", title: "Shorts", text: "Clips that open on a hook and stand on their own, framed on your face." },
          { track: "TXT", title: "The write-up", text: "Chapters, a YouTube description, an article and a thumbnail with you cut out in front of the title." },
        ],
        more: "[See every feature](/features)",
      },
      {
        kind: "shorts",
        h2: "One recording, a week of shorts",
        body: [
          "Pick how many and how long. ClipCat finds the moments that work on their own, opens each one on a hook and keeps the long edit's cuts. A face tracker that runs on your computer keeps you in the 9:16 frame.",
        ],
        note: "Up to 30, 60 or 90 seconds each, at 1080×1920.",
        shorts: [
          { length: "0:41", caption: "Nobody reads your", key: "App Store", rest: "page" },
          { length: "0:58", caption: "Launch", key: "twice.", rest: "Here's why" },
          { length: "0:33", caption: "The", key: "one", rest: "line every video needs" },
        ],
      },
      {
        kind: "agents",
        h2: "Uses the AI you already pay for",
        body: [
          "ClipCat runs no AI service of its own and has no account. It hands the transcript to the agent you're signed in to, and checks every suggestion it gets back against your words.",
        ],
        cards: [
          { title: "Claude Code", text: "Counts against your Claude plan. This is the default." },
          { title: "Codex", text: "Counts against your ChatGPT plan." },
          { title: "Claude API key", text: "Billed per use to your own Anthropic account." },
        ],
        h3: "Or let your agent drive",
        detail:
          "ClipCat's MCP server lets Claude Code, Codex and the Claude app open your projects, cut words, accept suggestions, make shorts and start exports while ClipCat is open. Every change goes through the same undo history as the editor.",
        session: [
          "> cut the part about pricing, then make three shorts",
          "clipcat  get_transcript  launch-video",
          "clipcat  cut_words       words 812–951 (4:12–5:03)",
          "clipcat  make_shorts     3, up to 60 s each",
          "clipcat  export_video    16:9 and 9:16",
        ],
        more: "[Set up your agent](/agents)",
      },
      {
        kind: "facts",
        h2: "Your footage never leaves your computer",
        cards: [
          { title: "Transcribed on your computer", text: "NVIDIA's Parakeet on the Neural Engine on Apple Silicon, and whisper.cpp everywhere else." },
          { title: "Only text goes out", text: "The transcript goes to the AI you chose, and only when you ask it for something." },
          { title: "No account, no tracking", text: "No ClipCat server, no analytics, no watermark and no export limit." },
        ],
        more: "[Read the privacy page](/privacy)",
      },
      {
        kind: "end",
        h2: "Your next video, mostly edited",
        body: ["ClipCat is free. It runs on Macs with macOS 14 or newer, Apple Silicon or Intel, and on 64-bit Windows 10 and 11."],
        download: true,
      },
    ],
  },
  {
    path: "/features",
    nav: "Features",
    title: "ClipCat features: cuts, captions, shorts and recording",
    description:
      "Everything ClipCat does: transcript editing, AI cut suggestions, captions, vertical shorts, punch-ins, b-roll, sound, recording and Final Cut timelines.",
    h1: "Everything ClipCat does",
    lede: "ClipCat is built for one kind of video: someone talking to the camera. Every feature is there to get that video from raw takes to posted with less fiddling.",
    updated: UPDATED,
    sections: [
      {
        h2: "Editing in the transcript",
        list: [
          "Click a word to jump the preview there. Shift-click to select a run of words, and press Delete to cut it. Press it again to bring it back.",
          "Suggested cuts for retakes, stumbles, filler and long pauses wait under the preview with a reason and a confidence. Accept or reject each one.",
          "Every edit can be undone and redone, and the preview always plays the edit with the cuts skipped.",
          "Ask for one-off changes in plain words, like \"cut the part about pricing\".",
          "Keep a list of the names and terms you use, and \"Fix transcript\" corrects only the words it's sure of.",
        ],
      },
      {
        h2: "Your AI, your choice",
        body: [
          "ClipCat doesn't run its own AI service. It uses the [Claude Code](https://claude.com/claude-code) or Codex subscription you already have, or your own Claude API key. The AI gets one tool, for handing back its suggestions, and no access to your files, shell or the web.",
        ],
      },
      {
        h2: "Captions, shorts and framing",
        list: [
          "Burned-in captions from the kept words, a word or a sentence at a time, in the style you pick, plus an .srt file.",
          "Make shorts of up to 30, 60 or 90 seconds. Each one opens with a hook, stands on its own, and keeps the long edit's cuts.",
          "The vertical crop follows the speaker's face, found on your computer with MediaPipe's face detector, and moves only at cuts.",
        ],
      },
      {
        h2: "Punch-ins, b-roll, slides and sound",
        list: [
          "Punch-ins zoom toward the speaker to give a line weight: a snap, a quick push or a slow creep.",
          "B-roll lays your own pictures and clips over the talking, full frame or picture in picture.",
          "Motion slides are short animated cards (a title, a list, a number) designed by the AI in ClipCat's style.",
          "Sound effects land on the word they belong to, and music ducks while you speak.",
        ],
      },
      {
        h2: "Recording",
        body: [
          "Record straight into a project: your camera, a screen with your voice and optionally the computer's sound, or a voice-only take. On macOS 15 the screen is recorded with ScreenCaptureKit and ClipCat's own window stays out of the picture.",
        ],
      },
      {
        h2: "Writing it up",
        body: [
          "ClipCat writes chapters, a description and an article from the edited transcript in your voice. Copy the description and chapters for YouTube in one click, and design a thumbnail from your best frame with you cut out in front of the title.",
        ],
      },
      {
        h2: "Export, or finish elsewhere",
        list: [
          "Export H.264 video with your computer's own hardware encoder: 16:9 at up to 1440p, or 9:16 at 1080×1920, at speeds from 0.5× to 2×.",
          "Save the edit as a timeline for Final Cut Pro (FCPXML, which DaVinci Resolve opens too), Premiere Pro (Final Cut 7 XML) or any editor that reads a CMX 3600 EDL.",
        ],
      },
      {
        h2: "Drive it from your coding agent",
        body: [
          "Connect Claude Code, Codex or the Claude desktop app from ClipCat's settings, and the agent can read your projects, cut words, accept suggestions, start exports and import recordings while ClipCat is open. Every change goes through the same undo history as the editor.",
          "The [agent guide](/agents) shows how to set it up and what to ask.",
        ],
      },
    ],
  },
  {
    path: "/agents",
    nav: "Agents",
    title: "Use ClipCat from Claude Code, Codex or the Claude app",
    description:
      "How to connect ClipCat to Claude Code, Codex or the Claude desktop app, check it worked, and what to ask so the agent edits your videos for you.",
    h1: "Edit from Claude or Codex",
    lede:
      "ClipCat comes with an MCP server, so the agent you already use can open your projects, read the transcripts and make the edit while you watch it land in ClipCat.",
    updated: UPDATED,
    sections: [
      {
        h2: "How it works",
        body: [
          "Connecting adds a ClipCat entry to the agent's own settings file. When the agent starts, it runs a small ClipCat helper on your computer that talks to the open ClipCat window. There's no account and no sign-in, and nothing goes over the internet.",
          "The agent reads the numbered transcript first, then cuts words, accepts or rejects suggested edits, adds punch-ins, b-roll, slides and sounds, and starts jobs like shorts and exports. Every change is one undo step in ClipCat, just like an edit you make yourself, and nothing deletes your footage.",
        ],
      },
      {
        h2: "Connect your agent",
        body: ["In ClipCat, open **Settings**. Under **Edit from your coding agent**, choose **Connect** next to the agent you use. ClipCat writes its entry here:"],
        list: [
          "**Claude desktop app**: `claude_desktop_config.json` in the Claude app's folder.",
          "**Claude Code**: `~/.claude.json`, for every folder you work in.",
          "**Codex**: `~/.codex/config.toml`, which the Codex CLI, the Codex app and the editor extension all read.",
        ],
      },
      {
        h2: "Start it and check",
        steps: [
          {
            title: "Claude desktop app",
            text: "Quit Claude completely (closing the window isn't enough) and open it again. Settings > Developer lists clipcat as running, and ClipCat's tools show in the tools menu of a new chat. Claude asks before it uses each tool the first time.",
          },
          { title: "Claude Code", text: "Start a new session, then type `/mcp`. clipcat should be listed as connected. A session that was already running won't see it." },
          { title: "Codex", text: "Start a new session, or quit the Codex app and open it again. In the CLI, `/mcp` lists clipcat and its tools." },
        ],
      },
      {
        h2: "Things to ask",
        body: ["Say \"ClipCat\" or \"my ClipCat project\" so the agent knows to use it. Keep ClipCat open while it works."],
        prompts: [
          "List my ClipCat projects and tell me which ones haven't been exported yet.",
          "In ClipCat, cut the filler words and long pauses from my newest project. Show me what you'll cut before you do it.",
          "Ask ClipCat's AI editor for cuts on my newest project, then accept the retakes and leave the rest for me.",
          "In my newest ClipCat project, cut the part where I talk about pricing.",
          "Add a punch-in on each line where I give a number, and a whoosh where each new topic starts.",
          "Make three ClipCat shorts of up to 60 seconds from my newest project.",
          "Write the chapters and a YouTube description for my newest ClipCat project.",
          "Import ~/Movies/take-1.mov and ~/Movies/take-2.mov into a new ClipCat project, and cut the retakes once it's transcribed.",
          "Export my newest ClipCat project as a 9:16 video to my Desktop, and save a Final Cut Pro timeline beside it.",
        ],
      },
      {
        h2: "Every tool it gets",
        list: [
          "**list_projects**, **get_project**, **get_transcript**, **list_proposals** and **list_jobs** read your projects, transcripts, suggested edits and what ClipCat is working on.",
          "**cut_words** cuts or restores a run of words. **decide_proposals** accepts or rejects suggested edits.",
          "**edit_project** makes any other change: punch-ins, b-roll, motion slides, sound effects, chapters, captions, speed, aspect ratio, music volume, the write-up, the thumbnail, and undo or redo.",
          "**find_cuts**, **make_shorts** and **write_up** ask ClipCat's own AI editor (the Claude Code, Codex or API key you picked in ClipCat) for cuts, shorts and a write-up.",
          "**import_videos**, **export_video** and **export_timeline** bring recordings in and send the video or a Final Cut, Premiere or EDL timeline out.",
        ],
      },
      {
        h2: "If it doesn't work",
        list: [
          "**The agent doesn't know about ClipCat**: quit it completely and open it again, then check its tool list as above.",
          "**It can't reach ClipCat**: open ClipCat and ask again.",
          "**A change is refused because the project changed**: you or the agent edited it in between. Ask it to read the project again and retry.",
          "**AI cuts or shorts fail**: those run on the AI you picked in ClipCat's settings, so check it's signed in.",
          "**Still stuck**: disconnect and connect again, or save diagnostics in Settings and attach them to an [issue](https://github.com/dqships/clipcat/issues).",
        ],
      },
    ],
  },
  {
    path: "/download",
    nav: "Download",
    title: "Download ClipCat for Mac and Windows, free",
    description:
      "Download ClipCat, the free talking-head video editor, for Macs on macOS 14 or newer, Apple Silicon or Intel, and 64-bit Windows 10 and 11.",
    h1: "Download ClipCat",
    lede: "ClipCat is free and needs no account. Pick your computer.",
    updated: UPDATED,
    sections: [
      {
        h2: "Installers",
        body: [
          "The Mac app runs on macOS 14 Sonoma or newer. Download for Mac gets the Apple Silicon (M1 or newer) build; Macs with an Intel processor have their own, which hears speech with whisper.cpp instead of Parakeet. To check yours, open the Apple menu, then About This Mac: it says Chip for Apple Silicon and Processor for Intel. On macOS 15 it records screens with ScreenCaptureKit, and on macOS 14 through Chromium's screen capture. The Windows app runs on 64-bit Windows 10 and 11.",
        ],
        download: true,
      },
      {
        h2: "After installing",
        list: [
          "For AI cuts, install [Claude Code](https://claude.com/claude-code) and sign in, or install the Codex CLI and sign in, or paste a Claude API key in ClipCat.",
          "The first transcription downloads the speech model once, a few hundred megabytes, from Hugging Face.",
          "ClipCat checks for updates every few hours and installs them when you restart.",
        ],
      },
      {
        h2: "Older versions and source",
        body: [`Every release, with its notes, is on the [releases page](${REPO}/releases). The source code is on [GitHub](${REPO}).`],
      },
    ],
  },
  {
    path: "/pricing",
    nav: "Pricing",
    title: "ClipCat pricing: free, with your own AI subscription",
    description:
      "ClipCat is free to download and use, with no account and no limits. AI cuts run on the Claude Code or Codex plan you already have, or your own Claude API key.",
    h1: "Pricing",
    lede: "ClipCat costs nothing. There's no account, no trial, no watermark and no export limit.",
    updated: UPDATED,
    sections: [
      {
        h2: "What you pay for",
        body: ["Only the AI you already use, and only if you use it. ClipCat works without AI too: transcription, editing, captions and export all run on your computer for free."],
        list: [
          "**Claude Code or Codex**: AI cuts, shorts, slides and write-ups count against the plan you already have.",
          "**Claude API key**: billed by Anthropic to your own account, per use. You pick the model in ClipCat.",
        ],
      },
      {
        h2: "Why it's free",
        body: ["ClipCat is a personal project, built for one person's videos and shared as is. It has no servers to pay for, because everything runs on your computer."],
      },
    ],
  },
  {
    path: "/about",
    nav: "About",
    title: "About ClipCat, a personal AI video editor",
    description:
      "ClipCat is a personal desktop video editor for people who talk to the camera. Here is why it exists, how it's built, and the open source work it stands on.",
    h1: "About ClipCat",
    lede: "ClipCat started as one person's tool for turning long, messy takes into tight videos without spending an evening in a timeline.",
    updated: UPDATED,
    sections: [
      {
        h2: "The idea",
        body: [
          "Editing a talking-head video is mostly the same chores every time: cut the retakes and pauses, punch in on the good lines, add the screenshots, the captions and a little sound, then cut shorts and write the description. ClipCat does that first pass with the AI you already use, lays every change out on the timeline with a reason, and leaves every call to you.",
        ],
      },
      {
        h2: "How it's built",
        body: [
          "ClipCat is an Electron app for macOS and Windows. Video is rendered with ffmpeg, speech is transcribed with NVIDIA's Parakeet (through FluidAudio) or whisper.cpp, faces are found with MediaPipe, and the subject cutout uses ISNet on ONNX Runtime. The name and the cat come from the cutting room: the C is a clip with a wedge trimmed out of it.",
        ],
      },
      {
        h2: "Open source",
        body: [`The source is on [GitHub](${REPO}). Parts of the app shell are adapted from Diffusion Studio's editor under the MPL-2.0, and the bundled tools keep their own licenses.`],
      },
    ],
  },
  {
    path: "/contact",
    nav: "Contact",
    title: "Contact ClipCat: questions, bugs and ideas",
    description:
      "How to reach ClipCat: report a bug or suggest a feature on GitHub, and attach a diagnostics file from the app so the problem can be found without guesswork.",
    h1: "Contact",
    lede: "ClipCat is run in the open on GitHub, and that's the place to get in touch.",
    updated: UPDATED,
    sections: [
      {
        h2: "Report a bug or ask a question",
        body: [`Open an issue on [GitHub](${REPO}/issues). Say what you did, what you expected and what happened instead.`],
      },
      {
        h2: "Send diagnostics",
        body: [
          "In ClipCat, open Settings and choose **Save diagnostics**. It saves one zip with the app's log, versions and recent jobs. It holds no video, sound or transcript. Attach it to your issue.",
        ],
      },
    ],
  },
  {
    path: "/privacy",
    nav: "Privacy",
    title: "ClipCat privacy: your videos stay on your computer",
    description:
      "ClipCat keeps your videos, audio and projects on your computer. It has no account, no analytics and no servers. Here is what leaves your machine, and when.",
    h1: "Privacy",
    lede: "ClipCat has no account, no analytics and no servers of its own. Your recordings and projects never leave your computer.",
    updated: UPDATED,
    sections: [
      {
        h2: "What stays on your computer",
        list: [
          "Your videos, audio, pictures and music, and everything ClipCat makes from them: proxies, waveforms, transcripts, faces found, cutouts and exports.",
          "Your settings and your Claude API key, which is stored encrypted with your system's keychain.",
          "Crash reports and the app's log, which are only shared if you attach a diagnostics file to an issue yourself.",
        ],
      },
      {
        h2: "What leaves it, and when",
        list: [
          "**When you ask the AI for something**: the text of the transcript (and, for b-roll and thumbnails, a few still frames) goes to the AI you chose: your Claude Code, your Codex or the Claude API with your key. Their own privacy terms apply.",
          "**Downloads**: the speech model is downloaded once from Hugging Face, and update checks read the release list on GitHub.",
          "Nothing else. ClipCat sends no analytics, usage data or crash reports anywhere.",
        ],
      },
      {
        h2: "This website",
        body: ["This site sets no cookies and runs no analytics or third-party scripts. It's served by Vercel, which keeps standard request logs."],
      },
    ],
  },
];

export const NOT_FOUND = {
  path: "/404",
  title: "Page not found | ClipCat",
  description: "There's no page at this address. Here are the pages ClipCat's site does have, so you can find what you were looking for.",
  h1: "Page not found",
  lede: "There's nothing at this address. It may have moved, or the link may have a typo.",
  sections: [{ h2: "Pages on this site", pageList: true }],
};
