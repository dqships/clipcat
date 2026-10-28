// Every page on the site, as data. Each one renders twice: as HTML for people
// and as Markdown for agents (the same URL with `Accept: text/markdown`, or the
// `.md` file beside it). Inline text may use [links](/path) and **bold**.

const REPO = "https://github.com/dqships/video-editor";
const DOWNLOAD = `${REPO}/releases/latest/download`;

export const SITE = {
  name: "ClipCat",
  repo: REPO,
  issues: `${REPO}/issues`,
  releases: `${REPO}/releases`,
  mac: `${DOWNLOAD}/ClipCat-arm64.dmg`,
  windows: `${DOWNLOAD}/ClipCat-x64-Setup.exe`,
  tagline: "Edit talking-head videos by editing the transcript.",
};

/** When the pages last changed in substance, for the sitemap. */
const UPDATED = "2026-10-28";

export const PAGES = [
  {
    path: "/",
    nav: "Home",
    title: "ClipCat: edit talking-head videos by editing the text",
    description:
      "ClipCat is a free desktop video editor for Mac and Windows. It transcribes takes on your computer and cuts retakes and pauses with your own Claude or Codex.",
    h1: "Edit your talking-head videos by editing the words",
    lede:
      "Drop in your raw takes. ClipCat transcribes them on your computer, finds the retakes, stumbles and long pauses, and lets you cut by deleting words. Then it captions what's left and exports it wide for YouTube and tall for Shorts.",
    hero: true,
    updated: UPDATED,
    sections: [
      {
        h2: "How it works",
        steps: [
          {
            title: "Bring in your takes",
            text: "Drag in recordings from your camera or phone, or record straight into ClipCat: your camera, your screen or just your voice.",
          },
          {
            title: "Read, then cut",
            text: "Every word is on the page. ClipCat marks the retakes and pauses it would cut, with a reason for each, and nothing is cut until you accept it. Delete any word yourself to cut it from the video.",
          },
          {
            title: "Export and post",
            text: "Render a captioned video in 16:9 and 9:16, with chapters, a description and a thumbnail ready to paste into YouTube.",
          },
        ],
      },
      {
        h2: "What it does",
        cards: [
          { title: "Cuts retakes and silences", text: "Your own Claude Code or Codex reads the transcript and proposes cuts. Each one is checked against the words before you see it." },
          { title: "Captions you can read", text: "Burned-in captions in Jost, a word or a sentence at a time, plus an .srt file beside every export." },
          { title: "Shorts that follow you", text: "Pick how many and how long. Each short opens on a hook, and the vertical crop follows your face." },
          { title: "Punch-ins, b-roll and slides", text: "Zoom in to land a line, lay your own clips over the talking, and add animated title cards." },
          { title: "Sound and music", text: "A small library of effects placed on the right word, and music that ducks under your voice." },
          { title: "Works with your agent", text: "Claude Code, Codex and the Claude app can open your projects and make edits through ClipCat's MCP server." },
        ],
        more: "[See every feature](/features)",
      },
      {
        h2: "Your videos stay on your computer",
        body: [
          "Transcription runs locally: NVIDIA's Parakeet on the Neural Engine on Apple Silicon, whisper.cpp everywhere else. Only the text of the transcript goes to the AI you choose, and only when you ask it for cuts. There is no ClipCat account and no ClipCat server. [Read the privacy page](/privacy).",
        ],
      },
      {
        h2: "Get ClipCat",
        body: ["ClipCat is free. It runs on Apple Silicon Macs with macOS 14 or newer and on 64-bit Windows 10 and 11."],
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
        ],
      },
    ],
  },
  {
    path: "/download",
    nav: "Download",
    title: "Download ClipCat for Mac and Windows, free",
    description:
      "Download ClipCat, the free talking-head video editor, for Apple Silicon Macs on macOS 14 or newer and for 64-bit Windows 10 and 11. Updates install themselves.",
    h1: "Download ClipCat",
    lede: "ClipCat is free and needs no account. Pick your computer.",
    updated: UPDATED,
    sections: [
      {
        h2: "Installers",
        body: [
          "The Mac app runs on Apple Silicon (M1 or newer) with macOS 14 Sonoma or newer. On macOS 15 it records screens with ScreenCaptureKit, and on macOS 14 through Chromium's screen capture. The Windows app runs on 64-bit Windows 10 and 11.",
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
          "Talking-head videos are mostly words. So ClipCat makes the words the editor: read the transcript, delete what you don't want, and the video follows. The AI does the tedious first pass, finding the retakes and pauses, and you make every call.",
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
