# Andum: Presentation and Demo Video Plan

| | |
|---|---|
| Document | `ANDUM-DEMO-PLAN.md` (companions: `ANDUM-PLAN.md`, `ANDUM-TEST.md`) |
| Version | 1.0, 11 Nov 2026 |
| Output | One **demo video** (master 2:15, uploadable to X), an **extended cut** (about 3:00, for the submission form and judges), a **live pitch** (3 minutes, 6 slides), an **X post and thread**, a **thumbnail** |
| Deadline | Repository public and submission sent before **14 Nov 23:59 UTC**. Target: video final by 14 Nov 16:00 UTC, post published by 18:00 UTC. |
| Conventions | **[HUMAN]** = needs the person (voice, account, publishing). **[VERIFY]** = check against the live source before relying on it. |

---

## 1. Goals and constraints

### 1.1 What the video must do

1. In the first 5 seconds, show a problem a stranger recognises: paying someone in parts means trust, chasing, and several transfers.
2. In 2 minutes, show the **real product working**, not slides: build a package, fund it, receive it, be refused early with a clear reason, approval, take.
3. Make the NEAR part visible without lecturing: the package is an NFT pass, rules live in a contract, nobody paid gas.
4. End with one clear thing to try or look at (link or repo).

### 1.2 Audience

| Viewer | Wants | Therefore |
|---|---|---|
| Hackathon judges | Working product, real NEAR integration, clear idea, honest scope | Show a live flow and an explorer transaction. State what is mock. |
| NEAR community on X | Something they can retweet in a sentence | Hook text and a caption that works with sound off |
| Contributors and small teams (the product's users) | Does it solve my payment problem | Use plain words: package, part, open, take |

### 1.3 Hard constraints

- **Length for X**: keep the master at **2:15 (135 s) or less**. Standard X accounts have a limit of about 2 minutes 20 seconds per video; longer videos need a Premium account. **[VERIFY]** the current limit in the composer before the final export. If the limit is higher for your account, still keep the master short; use the extended cut elsewhere.
- **X upload format**: MP4, H.264 video, AAC audio, 16:9 at 1920x1080 and 30 fps (also fine: 1:1 or 9:16 for a vertical cut), file under 512 MB, bitrate around 8 to 10 Mbps. **[VERIFY]** against X's current media specs.
- **Sound off**: most people watch muted. Every spoken line is also on screen as a burned-in caption. The video must make sense with no audio.
- **Honesty**: the product runs on NEAR testnet with mock assets and a demo bridge. The landing page and app do not say "testnet" up front (decision D-07), but the **video caption, post text and README must say it plainly** ("demo on NEAR testnet, mock assets"). This protects against a misleading-claims problem with the judges.
- **Claims**: show only what is built and verified (see section 8 for the claim checklist).
- **Rules from the hackathon**: the X post must say the project was built at NEAR HACKATHON, tag @NEARProtocol, use #NEARHackathon, and include a video or screenshots. **[VERIFY]** against the live `HACKATHON.md`.

### 1.4 Deliverables

| Deliverable | Format | Length | Used for |
|---|---|---|---|
| Master video | MP4 1080p, burned-in captions | 2:10 to 2:15 | X post |
| Vertical cut (optional, P2) | MP4 1080x1920 | 1:00 | Reels or shorts, if time |
| Extended cut | MP4 1080p | 2:50 to 3:00 | Submission form link, README, judges |
| Live pitch deck | Slides (Google Slides or PDF) | 3:00 spoken | If there is a live or recorded pitch round |
| Thumbnail | PNG 1280x720 | | Video poster, README |
| X post and thread | Text | | Publishing |
| Short GIF loop | GIF or MP4, 10 s | | README top |
| Screen recording raw footage | Folder | | Re-editing |

---

## 2. Story and structure

One idea per beat. The narrative is a single package followed from creation to the last part taken, with the refusal as the moment that proves it is real.

| # | Beat | Time | Viewer feels |
|---|---|---|---|
| 1 | Problem | 0:00 to 0:10 | "I have this problem" |
| 2 | One package, three parts | 0:10 to 0:22 | "Oh, simple" |
| 3 | Sender builds, names the link and sends | 0:22 to 0:56 | "Easy, and no fees or wallet words" |
| 4 | Receiver sees before accepting | 0:56 to 1:16 | "I would trust this" |
| 5 | Too early: refused with a reason | 1:16 to 1:32 | "It really enforces the rules" |
| 6 | Approval, then take | 1:32 to 1:54 | "It works" |
| 7 | Cross-chain (P2) | 1:54 to 2:04 | "Not stuck on one chain" |
| 8 | Why NEAR and close | 2:04 to 2:15 | "I know what to look at" |

If the bridge is cut (P2), replace beat 7 with a 10-second proof beat: the explorer page showing the transactions and the line "Paid by the relayer. Sender and receiver paid nothing."

---

## 3. Master video script (2:15)

Times are targets for the final cut. Voice-over (VO) is about 320 words (about 2.4 words per second). On-screen text (OST) is the burned-in caption and any label. Keep the pace calm; use cuts and fast-forward, not rushed speech.

### Beat 1: Problem (0:00 to 0:10)

| | |
|---|---|
| Visual | Black screen. Three short text cards appear one after another, then a chat bubble screenshot style: "Paid half. Rest when you finish." / "Did you send it?" |
| OST | "Paying someone in parts." / "Trust. Chasing. Three separate transfers." |
| VO | "Paying a contributor in parts usually means trust, chasing, and a few transfers you hope nobody forgets." |

### Beat 2: One package (0:10 to 0:22)

| | |
|---|---|
| Visual | Landing page hero timeline (from `andum-landing.html`) playing: three markers on one timeline (right away, a date, a date plus approval). Logo reveal. |
| OST | "Andum. One package. Each part opens on its own rule." |
| VO | "Andum sends money and assets in one package. Each part opens on its own rule: right away, on a date, or on a date plus someone's approval." |

### Beat 3: Sender builds, names the link and sends (0:22 to 0:56)

| | |
|---|---|
| Visual | Screen recording of the app as Alice. (a) Assets screen: tap mint, balance appears (1 s, cut). (b) Build: pick the template, three parts: 200 USDC right away; 800 USDC on a date plus approval from Budi; 1.5 g gold on a later date. Show the date markers on the timeline. (c) Review: "Network fee: Covered" highlighted. (d) Send: two confirmations, success screen. (e) **Customize the link** (6 to 8 seconds, real time, do not speed up): type `rina`, the amber chip says the name is taken; change it to `rina-audit-bonus`, the chip turns green; type the title "Your audit bonus"; the chat preview card below updates as typed (amount stays hidden); tap Copy. Use speed ramp 2 to 4 times for the form filling in (b) only. |
| OST | "200 USDC. Right away." / "800 USDC. On a date, with Budi's approval." / "1.5 g gold. On a later date." / "Network fee: covered." / "Name the link. Choose what the chat preview shows." |
| VO | "Here a sender builds one package for Rina: two hundred dollars right now, eight hundred on a date once Budi approves, and some gold later. No gas, no wallet vocabulary. Before sending, he names the link and chooses what the chat preview shows. The funds lock in a NEAR contract the moment it's sent." |

### Beat 4: Receiver sees before accepting (0:56 to 1:16)

| | |
|---|---|
| Visual | Split to a phone-width browser as Rina. Opens `andum.app/p/rina-audit-bonus` (the custom link is visible in the address bar), sees the custom title, sender, amounts, each part's rule, nothing hidden. Enters email code (show the email arriving in 1 second cut). Taps Accept. The gift she was sent opens (the sender picked the Surprise theme and wrote a one-line note), confetti falls, the note appears, then the package card. Keep this under 4 seconds on screen. Cut-away to the explorer showing an NFT minted to Rina's account. |
| OST | "Rina sees everything before she accepts." / "Email code, no seed phrase." / "The package is an NFT in her account." |
| VO | "Rina opens the link and sees exactly what's coming and when, before she accepts. She confirms with an email code. Accepting mints the package as an NFT into her account. That pass is what unlocks each part." |

### Beat 5: Too early (1:16 to 1:32)

| | |
|---|---|
| Visual | Rina taps Take on the 200 USDC part: balance jumps (green). She then taps Take on the 800 USDC part: a clear refusal card: "Not yet. This part opens on 14 Nov, and Budi still has to approve." Timeline view shows locked parts. |
| OST | "Open now: taken." / "Too early: the contract says no, and says why." |
| VO | "The first part is open, so she takes it. She tries the second, and the contract refuses, with a plain reason: not yet, and Budi still has to approve. The rules are enforced on chain, not by trust." |

### Beat 6: Approval and take (1:32 to 1:54)

| | |
|---|---|
| Visual | Switch to Budi's browser: approval request, one tap Approve. Clock fast-forward to the date (use the short demo times: this is real, show a countdown). Email appears: "A part of your package is open." Back to Rina: status "Open", tap Take, balance updates. Final state: all parts Taken. |
| OST | "Budi approves." / "The date passes. Rina gets an email." / "Take. Done." |
| VO | "Budi approves with one tap. When the date arrives, Rina gets an email, taps Take, and the money lands in her account. One package, three rules, no chasing." |

### Beat 7: Cross-chain (1:54 to 2:04) (P2)

| | |
|---|---|
| Visual | A wallet on Base Sepolia receives mock USDC from Andum (or the reverse): the bridge progress bar, explorer tab on the EVM chain. A small badge "Demo bridge". |
| OST | "Receive from or send to other chains. Ethereum Sepolia, Base Sepolia." / "Demo bridge, mock assets." |
| VO | "And it isn't stuck on one chain: the same assets can come in from, or go out to, Ethereum and Base." |

### Beat 8: Why NEAR and close (2:04 to 2:15)

| | |
|---|---|
| Visual | Architecture strip (one slide, 6 s): "NEAR contract holds and enforces rules. NFT pass. Relayer pays gas (NEP-366)." Then end card: logo, URL, repo, "Built at NEAR HACKATHON. Demo on NEAR testnet, mock assets." |
| OST | "Rules in a NEAR contract. The package is an NFT. Gas paid by a relayer." / "andum.app (placeholder) | github.com/ORG/andum" |
| VO | "Andum runs on NEAR: the rules live in a contract, the package is an NFT, and a relayer pays the gas. Packages that open on their own terms. Try it." |

Replace the URL placeholders with the real ones before export. **[HUMAN]**

### Word budget check

Total VO: about 320 words, about 133 seconds at 2.4 words per second. If a read-through runs over 2:15, cut in this order: beat 7 first, then half the beat 1 text, then shorten the beat 3 VO.

---

## 4. Extended cut (about 3:00)

Same master, with these additions. Keep the first 2:15 identical so editing is cheap.

| Add | Time | Content |
|---|---|---|
| Problem depth | +8 s | Three real-life cases as quick cards: gift for a birthday, freelance milestone, a company bonus that vests |
| Link options | +6 s | Show the "Suggest" button and the amount-in-preview switch turned on, with the preview card updating |
| Reclaim | +12 s | Sender takes back an unaccepted package after its deadline; shows funds return |
| Under the hood | +20 s | Contract view in the explorer: package id, parts, `part_claimed` event; relayer paying gas; sender balance unchanged |
| Honest scope | +8 s | Text card: "What is mock: tokens, bridge. What is real: the contract, the rules, the gasless flow." |
| Roadmap | +7 s | Three lines: mainnet, real stablecoins, NEAR Intents for real cross-chain |

---

## 5. Combined pitch: problem, solution, technical, demo

One continuous talk with four parts. The demo sits in the middle so the audience has **seen it work** before hearing how. Default length is **3:00**; a **5:00** variant is below. Ask the organisers for the real slot and use the matching table. **[HUMAN]**

### 5.0 Shape

| Part | Question it answers | Share of time | Proof it must contain |
|---|---|---|---|
| 1. Problem | Who hurts, and how do they cope today? | 20% | One concrete scene, not statistics we cannot source |
| 2. Solution | What is Andum in one sentence? | 15% | The three-rule timeline (right away, date, date plus approval) |
| 3. Demo | Does it really work? | 30% | The refusal moment and an explorer transaction |
| 4. Technical | Why NEAR, and why can we trust it? | 25% | Architecture, gasless flow, invariants and tests |
| 5. Close | What is real, what is next, what to look at | 10% | Links, tracks, honest scope |

Slides are visual: one idea each, large type, no paragraphs. Reuse the landing page look (dark, one accent colour). Speak about 400 words in 3:00.

### 5.1 Three-minute version (6 slides)

| # | Slide | Time | Content | Say |
|---|---|---|---|---|
| 1 | Problem | 0:00 to 0:30 | Chat bubbles: "Paid half. Rest when you finish." / "Did you send it?". Three scenes: contributor payment, gift, company bonus | Money in parts today means trust, chasing and manual transfers. Name how people cope (escrow services, spreadsheets, reminders) |
| 2 | Solution | 0:30 to 1:00 | Logo, one-line promise, timeline with three markers | "Andum sends money and assets in one package. Each part opens on its own rule: right away, on a date, or on a date plus approval. The receiver sees everything before accepting." |
| 3 | Demo | 1:00 to 2:00 | Live run, or the pre-recorded 60-second cut of beats 3 to 6 in `ANDUM-DEMO-PLAN.md` section 3 | Narrate the four moments: send, receiver sees first, refused early with a reason, approval then take |
| 4 | Technical | 2:00 to 2:35 | One diagram (section 5.3) and three short lines: NFT pass, gasless via delegate actions, rules and invariants tested | See 5.3 |
| 5 | Scope and next | 2:35 to 2:50 | Left: built (NEAR contracts, backend, app, EVM demo). Right: next (mainnet, real assets, NEAR Intents) | State plainly what is mock |
| 6 | Close | 2:50 to 3:00 | Repo and demo links, QR code, tracks | Tracks: **NFTs That Do Something** (primary), **Real-World Money**. **[VERIFY]** names against the live hackathon page. Do not claim Social Money unless a DAO flow exists |

### 5.2 Five-minute version (8 slides)

Same order with more room. Add: a **"Why now / why us"** beat in the problem part, a **second demo moment** (reclaim or cross-chain), and a deeper technical slide.

| # | Slide | Time |
|---|---|---|
| 1 | Problem | 0:00 to 0:45 |
| 2 | Who it is for and how they cope today (comparison: escrow, streams, gift links, Andum) | 0:45 to 1:15 |
| 3 | Solution | 1:15 to 1:45 |
| 4 | Demo, main flow | 1:45 to 3:05 |
| 5 | Demo, second moment (reclaim, or send to Base Sepolia) | 3:05 to 3:30 |
| 6 | Technical architecture | 3:30 to 4:15 |
| 7 | Scope, trust points, next | 4:15 to 4:40 |
| 8 | Close | 4:40 to 5:00 |

### 5.3 Technical slide content

Keep it understandable to a non-Rust judge in 30 seconds. One diagram, three claims, one proof line.

**Diagram** (left to right): Web app → API and relayer → NEAR `core` contract (holds funds, enforces rules, mints the NFT pass) → token contracts. Below: a dotted branch to the EVM gateways on Ethereum Sepolia and Base Sepolia, labelled "demo bridge".

**Three claims, each tied to evidence:**

| Claim | Say | Evidence on the slide |
|---|---|---|
| The rules live on chain | "Each part opens only when its date has passed and its approver has approved. The contract checks it, not our server." | Screenshot of the refusal and the contract error code |
| The package is an NFT pass | "Only the owner of the pass can take a part. It cannot be transferred while parts are still closed." | Explorer view of the NFT in Rina's account |
| Users never pay gas | "Users sign an action; a relayer submits it and pays. A policy engine limits what the relayer will pay for." | Explorer view: relayer paid, user balance unchanged |

**Proof line (fill with real numbers only after the test report exists):** "`<N>` contract tests, `<M>` randomised sequences, no double payout, no admin method that moves funds." If numbers are not available, say instead: "Invariants are tested: a part is paid at most once, and nobody but the pass owner can be paid."

**Honest trust points (one small line):** admin can upgrade the contract; the demo bridge is a trusted relayer; tokens are mock.

### 5.4 Speaker notes: who says what

If two people present: one covers problem and solution and the close; the other covers the demo and the technical part. Hand over with a full sentence, not a slide change in silence. If one person presents, rehearse the demo and technical parts most; the problem and solution parts are only 50 seconds.

### 5.5 Demo inside the pitch

- **Prefer a pre-recorded 60-second cut played from the deck**, with the presenter talking over it live. It cannot fail, and the voice stays natural. Keep a live run only as an optional extra if time and the environment are solid.
- If doing it live: three browser profiles already logged in (alice, rina, budi), short timings, a countdown visible, the fallback video one click away.
- Always show the refusal moment and one explorer tab. These two moments carry the proof.
- Do not wait on the network on stage: if a step takes longer than 10 seconds, cut to the recording and say so.

### 5.6 Rehearsal plan

| When | What |
|---|---|
| 13 Nov | Read the script aloud; time each part; trim to the slot |
| 14 Nov morning | Full run with the real build; two people watch and ask three questions each |
| 14 Nov before submitting | One run with a timer, no stops, including the fallback switch |

Target: land at 90 to 95 percent of the slot, so a stumble does not run over.

### 5.7 Q&A prep (likely judge questions)

| Question | Honest short answer |
|---|---|
| What's real and what's mock? | The NEAR contract, rules, NFT pass, relayer, backend and UI are real and run on NEAR testnet. Tokens (stablecoins, gold, stocks) and the cross-chain bridge are mocks for the hackathon. |
| How is this gasless? | Users sign a delegate action (NEP-366). A relayer submits it and pays gas. Funding transfers still carry 1 yoctoNEAR, which comes from the user's account, so new accounts get a tiny top-up. |
| What stops the relayer being abused? | A policy engine: allowed contracts and methods only, deposit and gas caps, quotas, expiry, and replay protection. It holds no user funds. |
| Why not an escrow contract or streaming payments? | Those pay by time or by one release. Here each part can have its own date and its own approver, and the receiver owns the package as an NFT, so they can see everything up front. |
| What if the approver never approves? | The part stays closed. That is a known limitation; refund rules are the next design decision. |
| Who can move the money? | Nobody but the NFT owner, and only when a part's rules are met. The admin can pause and upgrade but has no method that moves funds. Upgrade key is a stated trust point. |
| Is the bridge real? | No. It is a trusted relayer that burns on one chain and mints on another, for demonstration. The production path is NEAR Intents. |
| Does login need a seed phrase? | With an embedded wallet, no. If embedded wallets cannot sign for NEAR yet, demo accounts use a local key. (State which one the demo uses.) |
| What is the business model? | Not a hackathon question, answer in one line: a small fee on packages and treasury tooling for teams. Mark it as a hypothesis. |
| What did you build during the hackathon? | Contracts, backend, app and the demo; the HTML prototypes and the brand kit existed as design material, disclosed in the README. |

---

## 6. Production plan

### 6.1 Roles

| Role | Who |
|---|---|
| Director and owner of every decision | **[HUMAN]** |
| Voice-over | **[HUMAN]** (own voice gives credibility). Fallback: text-to-speech if the person prefers; keep captions either way |
| Screen recording and editing | **[HUMAN]** with an agent preparing scripts, shot lists and caption files |
| Script, shot list, captions, thumbnail text, post copy | Agent (this document, then a copy pass using the copywriting skill) |
| Demo environment, seed data, reset scripts | WS-F agent |

### 6.2 Demo environment (prepare before recording)

The demo must run reliably in one take per beat. Do not rely on live testnet speed for the long waits.

| Item | Setup |
|---|---|
| Accounts | `alice` (sender), `rina` (receiver), `budi` (approver), pre-created and pre-funded by `scripts/seed.sh`. Each in its own browser profile with a name and avatar so the viewer can tell them apart. |
| Timings | Use fixtures with a 90-second date for part 2 and 150 seconds for part 3. In the video, speed-ramp the waiting, but show a real countdown. |
| Data reset | `scripts/seed.sh --reset-demo` creates a fresh package set; run before each take. |
| Reliability | Record each beat as its own clip. Keep a **fallback recording** of a fully successful run in case testnet is slow on the final day. |
| Email | Use the real email provider to a test inbox, or Mailpit; record the inbox view as a separate clip. |
| Explorer | Pre-open explorer tabs for the NFT and for one claim transaction; zoom so hashes are readable. |
| Cross-chain | Pre-fund the EVM wallet with test ETH and mock USDC; run the bridge once before recording to confirm it works, record the second run. |
| Display | 1920x1080, browser zoom 110 to 125 percent so text is readable on a phone, hide bookmarks, notifications off (Do Not Disturb), clean desktop, dark theme. |
| Network | Wired or strong connection, no VPN switching, no other heavy downloads. |

### 6.3 Recording setup

- Tools **[HUMAN]** chooses: OBS Studio (free) or the OS screen recorder for screen capture; a USB or headset microphone; a quiet room. Record the voice-over separately from the screen to allow re-takes.
- Settings: 1920x1080, 30 fps, MP4 or MKV, screen capture at 1080p, microphone at 48 kHz, record 5 seconds of room tone for noise reduction.
- Capture cursor with a subtle highlight; use a click ring effect for taps. Slow smooth mouse movement.
- Take each beat 2 to 3 times; keep the best. Leave 2 seconds of silence before and after each clip.

### 6.4 Voice-over

- Read the script aloud twice to time it; keep a calm, even tone, one idea per breath.
- Record in one session, in short takes per beat, with a pop filter or a sock over the microphone if needed.
- Clean-up: noise reduction, normalise, light compression, then target loudness about -16 LUFS for social video. **[VERIFY]** against X's recommendations if desired.

### 6.5 Editing

Any editor works (DaVinci Resolve free, CapCut, iMovie, Premiere). Rules:

1. Assemble beats in the order of section 3; cut to the VO.
2. Fast-forward long waits (speed ramp 2 to 4 times) and keep one real countdown.
3. Zoom into the specific element being described (amount, status chip, the refusal card). Use gentle 120 percent zoom, not shake effects.
4. Captions: burn in, large, white text with a dark pill background, bottom third, max two lines, 4 to 6 words per second reading speed. Keep captions inside the safe area so X's UI does not cover them.
5. Name labels for the three people (Alice, Rina, Budi) appear the first time each is on screen.
6. One accent colour from the brand kit; no flashing, no loud transitions.
7. Background music optional: soft, low, instrumental, royalty-free with a licence that allows social posting. Duck it under the voice by at least 18 dB. If unsure, skip music.
8. Add a 1-second fade in and out; the end card holds for 3 seconds.
9. The first frame should be a strong still, since X may show it before play.
10. Export the master at 1920x1080, 30 fps, H.264, AAC 128 to 192 kbps, 8 to 10 Mbps video bitrate, "fast start" (web optimised). Name `andum-demo-master-v1.mp4`.

### 6.6 Thumbnail

1280x720, dark background, the timeline graphic with three markers, large text "One package. Three rules." (or the final headline), small logo bottom-left. High contrast; readable at 300 px wide. Use the brand-kit logo and colours.

---

## 7. X post and thread

Voice: plain, specific, no hype words, no "revolutionary", no "game changer". Do not use "it's not X, it's Y" constructions. All claims must be true on the day.

### 7.1 Main post (video attached)

Fits comfortably within the character limit. Variants below; pick one **[HUMAN]**.

**Variant A (problem first):**
```
Paying someone in parts usually means trust, chasing and a few transfers.

Andum sends money and assets in one package. Each part opens on its own rule: right away, on a date, or on a date plus someone's approval.

Built at NEAR HACKATHON by @HANDLE. Demo runs on NEAR testnet with mock assets.

@NEARProtocol #NEARHackathon
[video]
```

**Variant B (show the moment):**
```
A part of your package says "not yet" and tells you why.

That's Andum: one package, three rules (right away, on a date, on a date plus approval). The package is an NFT in the receiver's account. Nobody pays gas.

Built at NEAR HACKATHON. Demo on NEAR testnet, mock assets.

@NEARProtocol #NEARHackathon
[video]
```

Replace `@HANDLE` with the team's handle. **[HUMAN]**

### 7.2 Thread (optional, 4 replies, screenshots or short clips)

1. **How it works**: image of the three-part timeline. "Sender funds the package once. Rules are enforced by a NEAR contract."
2. **The receiver's view**: phone screenshot of the pre-accept screen. "Rina sees every amount and rule before she accepts. Accepting mints the package as an NFT that unlocks each part."
3. **Gasless**: explorer screenshot. "Users sign, a relayer submits and pays gas (NEP-366). Sender and receiver paid no gas in this demo." Only post after test NF-01 passes.
4. **Links and honesty**: "Repo: <link>. Live demo: <link>. What is mock: tokens and the cross-chain bridge. What is real: the contract, the rules, the relayer. Tracks: NFTs That Do Something, Real-World Money."

### 7.3 Posting rules

- Post the video as a **native upload**, not a link, so it autoplays.
- Pin the post to the profile until the judging ends.
- Reply to the first comments quickly; quote the post once with a 20-second GIF if engagement is low.
- Keep the demo hosted until judging ends (hackathon: 18 Nov, ideally to 25 Nov). **[VERIFY]**
- **Agents never post or submit.** **[HUMAN]** publishes and fills the submission form.

---

## 8. Claims checklist (tick before export and before posting)

| Claim in the video or post | Allowed only if | Evidence |
|---|---|---|
| "Nobody pays gas" | NF-01 passed in E2E-01 for alice, rina and budi, and the 1-yocto and top-up caveat is not contradicted | Test report, explorer |
| "Package is an NFT" | NFT visible on the explorer for Rina's account | Screenshot |
| "Rules enforced on chain" | The refusal in beat 5 comes from the contract (`TIME_NOT_REACHED` or `APPROVAL_MISSING`) | Relay job result |
| "Email code, no seed phrase" | Embedded wallet works for NEAR (spike S-02 passed) | Verify log. Else say "demo account" |
| "Receive from or send to other chains" | E2E-07 and E2E-08 passed, labelled demo bridge | Test report |
| "Real money" | Never | The assets are mock |
| Asset names (USDC, gold, AAPL, NVDA, TSLA) | Shown as mock tokens in the caption | |
| Link preview card | It is the app's preview of how chat apps will show the link. Before saying "this is what it looks like in a chat", test the real link in one chat app and show that screenshot instead, or call it "preview" on screen | Screenshot |
| Any number (amounts, times, speeds) | Shown on screen as it happened | Raw footage |
| "Built at NEAR HACKATHON" | Contracts, backend and app were written during the hackathon, and the prototypes disclosed in README | README |

---

## 9. Timeline (UTC)

| When | Task | Owner |
|---|---|---|
| 11 Nov | Approve this plan. Pick voice-over method and editor. Agent drafts final script, caption file, thumbnail text. | Human, agent |
| 12 Nov | Lock script wording against the real UI labels as screens are built. Record **screen-only rough takes** of the prototype for timing (not for publish). | Human, agent |
| 13 Nov (late) | Demo environment frozen (after UAT round 1). Record fallback full run. Record all beats. | Human |
| 14 Nov 00:00 to 08:00 | Voice-over, rough cut | Human |
| 14 Nov 08:00 (code freeze) | Re-record only clips affected by any UI change. | Human |
| 14 Nov 10:00 | Final cut, captions, thumbnail | Human |
| 14 Nov 13:00 | Review against the claims checklist (section 8); one external viewer watches it muted and unmuted | Human, agent |
| 14 Nov 16:00 | Export master and extended cut; upload test to X as a draft or private test **[VERIFY]** and check quality | Human |
| 14 Nov 18:00 | Publish post; copy the post link | Human |
| 14 Nov 20:00 | Submit the form with repo and post links (deadline 23:59) | Human |

Cut lines: if the schedule slips, drop the vertical cut, the thread, and then the cross-chain beat, in that order. Never drop the claims review.

---

## 10. Risk and fallback

| Risk | Fallback |
|---|---|
| Testnet slow or down during recording | Use the pre-recorded fallback run; label nothing as live |
| Embedded wallet cannot sign for NEAR | Use demo accounts; do not show "no seed phrase" as a claim; caption "demo account" |
| Email delayed | Pre-record the inbox clip; cut with a countdown |
| Bridge unreliable | Cut beat 7; use the gasless proof beat instead |
| UI changes after recording | Re-record affected clips only; keep each beat as a separate file |
| Over length | Cut order in section 3 (word budget) |
| X rejects or recompresses the file | Re-export at 1080p, 8 Mbps, check codec, ensure under the duration limit; upload from desktop web |
| Voice quality poor | Re-record in a closet or under a blanket; or use TTS with captions |

---

## 11. Checklists

### 11.1 Pre-recording

- [ ] Demo build deployed; `scripts/smoke.sh` passes
- [ ] Three browser profiles with names, dark theme, notifications off
- [ ] Seed data reset; short timings configured
- [ ] Explorer tabs ready; email inbox ready
- [ ] Screen at 1080p, zoom set, cursor highlight on
- [ ] Script printed or on a second screen; water nearby

### 11.2 Pre-publish

- [ ] Length 2:15 or less; file under the X limit; plays muted
- [ ] Captions readable on a phone, no typos, no cut-off at the edges
- [ ] Wording matches the app (Open, Waiting for date, Waiting for approval, Processing, Taken)
- [ ] Claims checklist ticked (section 8)
- [ ] "Built at NEAR HACKATHON", @NEARProtocol, #NEARHackathon in the post
- [ ] "Demo on NEAR testnet, mock assets" in the post and the end card
- [ ] Links work (repo public, demo up, README quick start tested)
- [ ] Thumbnail set; post previewed on a phone

### 11.3 Post-publish

- [ ] Post link saved in the README and in the submission form
- [ ] Demo stays online until judging ends
- [ ] Respond to comments for the first 2 hours


---

## 12. Update, 13 Nov 2026: the demo now runs in the real web app

The beats in section 3 can now be recorded **in the browser, not in a terminal**. `docs/media/app-demo.mp4` (about 1:54) and `app-demo.gif` were cut from the recordings of the Playwright journey test (`andum-web/e2e/journey.spec.ts`) with `scripts/demo/make-ui-demo.mjs`:

| Beat in section 3 | In the recording |
|---|---|
| 3 Sender builds, names the link and sends | Segment 1: sign in, faucet, two parts (one dated with an approver), send. No gas |
| 4 Receiver sees before accepting | Segment 2: the link page shows 1,000 USDC locked in two parts; a wrong invite code is refused |
| 5 Too early | Segment 3: accept, take part 1, take part 2: the contract says it is not open yet |
| 6 Approval and take | Segments 4 to 6: still refused without approval, the approver says yes, part 2 is taken |

To re-record: `cd andum-web && VIDEOS=/tmp/v SHOTS=../docs/media/app npx playwright test journey`, then `node scripts/demo/make-ui-demo.mjs /tmp/v docs/media`. The journey waits about 3 minutes for the date, which the cut removes. A voice-over, burned-in captions and the cross-chain beat (7) are still to do. Say "NEAR testnet, test money" in the caption and post, as in section 1.3.
