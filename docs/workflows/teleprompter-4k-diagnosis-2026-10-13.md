# Teleprompter 4K diagnosis — October 13, 2026

## Finding

The new 4K recording is choppy. The largest measured loss is around browser video presentation and delivery of JavaScript frame callbacks, before most canvas copies. The file retains almost every frame that was copied. This locates the failing stage, but does not identify one exact browser defect or app operation as the cause.

The owner also reports visible chop in the preview before recording. Sol confirmed that a fresh idle preview does not run the recording canvas pump. A recording-only fix cannot, by itself, explain that preview symptom. Rendering effects, browser/source cadence, and ongoing queue work remain candidates.

Initial scope was diagnosis only. The owner subsequently approved a repair, requested removal of the two-version notification, and requested immediate playback of the phone copy before Drive upload. The owner says 1080p is satisfactory; preserve that recording path. Current AGENTS.md allows 4K at 30–60 fps; the observed 11.18 fps fails even its 30 fps floor. The stricter video rule still keeps 60 fps as a failed/open proof until the original saved file demonstrates it.

**Owner decision:** 4K must keep front/back switching during a single recording. A fixed-lens direct-camera recorder was proposed and explicitly rejected. The candidate therefore keeps the stable canvas track but uses a WebGL surface for full 4K frames. Lower-resolution/Ad recording retains the existing 2D path. No camera constraint, script speed, preview effect, orientation behavior, or upload-byte change is part of this candidate.

Luna re-read the fresh Drive descriptions: the Thank You source track and preview both report **2160×3840 at start and end**, facing `user`, granted 30 fps. The source is genuinely portrait 4K rather than a smaller frame enlarged to 4K. The existing IndexedDB queue saves accepted files before upload, but it had no local player. Requested local playback and user-triggered phone export reuse those same original bytes.

### Candidate proof, still awaiting real iPhone evidence

A real desktop WebKit encoder using the actual app and the same synthetic 4K source produced playable 2160×3840 MP4s: **148 decoded frames / 3.623 s (~40.6 fps)** with WebGL versus **85 / 3.833 s (~21.9 fps)** through the original 2D path. The GPU test recorded zero 2D recording drawImage calls. This controlled comparison supports the candidate, but does not prove real iPhone cadence or fix the reported idle-preview symptom. A physical iPhone preview and original saved 4K file remain required.

The final encoder run, including allocation checks and post-draw GL error checks, decoded **142 frames / 3.158 s (44.64 fps)**. It made 159 texture uploads/draws and frame requests without request failures. Those are GPU submissions, not 159 encoded frames. The final comparison baseline decoded 106 frames / 3.803 s (27.61 fps); earlier trial numbers above remain historical. The actual local player loaded the resulting MP4 and displayed its first decoded portrait frame. A separate synthetic microphone run decoded the expected AAC tone. See `teleprompter-video-2026-10-12-evidence/gpu-encoder-comparison-2026-10-13.json` for exact hashes and limits.

Recorded checks: 112 scoped unit tests passed; lint passed. The 57-case Chromium recording suite passed, followed by the additional GPU draw-failure check. Requested local playback tests passed 5/5 in Chromium and regular WebKit. WebKit's recording suite passed 54/57 initially, with the same gesture contract later passing using its native pointer API and the GPU draw-failure case passing separately. Two intentional reload-during-upload cases still emit an internal Blob cancellation error even though original-byte recovery and per-take diagnostics assertions pass. Both errors reproduce against the unchanged `origin/main` teleprompter JavaScript in the same test environment, with no new player URLs; they are not counted as passes or fixed by this recording repair. TypeScript remains red in unchanged `src/marketing/filmed-receive.mjs:159`.

## Fresh originals checked by Luna

- [1080p Ad — Paying for speed](https://drive.google.com/file/d/1rPZ5rVDV3O28ox0RP9LANfr-faQGCT_z/view): 94,018,005 bytes; modified October 13 at 5:46:29 a.m. Phoenix. All 627 video frames and 984 AAC audio frames decode without error. Video is 1080×1920, 29.94 effective fps, with no exact repeated frame hashes. Largest saved timestamp gap: 83.3 ms.
- [4K Thank You take](https://drive.google.com/file/d/104qBp8jwVBvn3xXPhvmszMIL1MUCFB4N/view): 82,285,083 bytes; modified October 13 at 5:47:20 a.m. Phoenix. All 142 video frames and 595 AAC audio frames decode without error. Video is 2160×3840, 11.18 effective fps, with no exact repeated frame hashes. Median saved interval: 85 ms; largest gap: 213.3 ms.
- Download sizes and independently calculated MD5 hashes match Drive metadata for both originals. No separate on-device hash was available. Visual samples are upright and fill the frame without visible bars; the 4K sample is soft/noisy. Samples do not prove every image is uncropped relative to the physical camera.
- Both tracks report 30 fps at start/end and a capability maximum of 60 fps. Those are granted settings and capability ranges, not measured sensor delivery.

Machine-readable counts and timestamps: `teleprompter-video-2026-10-12-evidence/fresh-integrity-report-2026-10-13.json`. Original MP4s and private frame samples remain outside Git.

## Exact stage comparison

**Ad, 20.998 seconds:** 629 presented-frame increments − 2 missed callbacks = 627 delivered callbacks. There are 628 copies including the initial paint and 627 encoded frames. Average synchronous draw/capture work is 3,845 / 628 = **6.12 ms/copy**, maximum 28 ms. There is little additional frame-count loss after copying.

**4K, 12.760 seconds:** 235 presented-frame increments − 93 missed callbacks = 142 delivered callbacks. There are 143 copies including the initial paint and 142 encoded frames. Average synchronous draw/capture work is 2,903 / 143 = **20.30 ms/copy**, maximum 39 ms. About 40% of the presented increments were not delivered as callbacks. Presentation increments averaged about 18.4/s, callbacks about 11.1/s. These counters do not count every sensor frame.

60 fps leaves 16.67 ms per frame. The measured average 4K synchronous operation exceeds that budget before other work is included. At 30 fps the budget is 33.33 ms; the average is below it, so copy cost alone does **not** explain the full fall to 11 fps. The measurement includes transforms, drawImage, and requestFrame, and does not isolate their separate costs or asynchronous GPU/encoder work.

## Code compared with official sources

1. **Callback delivery — closest match.** The [requestVideoFrameCallback specification](https://wicg.github.io/video-rvfc/) says callbacks are best effort and can miss presented frames under main-thread load. `presentedFrames` counts composition submissions, not sensor acquisitions. Our 93 missed callbacks and near-equal copied/encoded counts match this failure class. They do not prove which work caused the load.
2. **Preview effects — plausible, unmeasured.** Our native video has blur(1.6px); the lower third adds backdrop blur(3px) and a mask; visible glass controls use further backdrop filters. [WebKit's backdrop-filter explanation](https://webkit.org/blog/3632/introducing-backdrop-filters/) confirms extra rendering passes and a performance cost. This can run before Record and fits the owner's preview report, but there is no device trace or controlled comparison proving it caused the chop.
3. **Camera capability — not a 4K60 guarantee.** The [Media Capture specification](https://w3c.github.io/mediacapture-main/) explicitly says capability ranges cannot express resolution/frame-rate interactions. A maximum of 60 therefore does not prove 4K60 is supported. Both fresh grants were 30. The failed/rejected 60 fps attempts and the reason for the selected fallback are not preserved in these reports.
4. **High-resolution canvas bugs — related history, no confirmed match.** [WebKit bug 256366](https://bugs.webkit.org/show_bug.cgi?id=256366) involved high-resolution camera-to-canvas memory growth and GPU crashes and was fixed in 2023. [Bug 229668](https://bugs.webkit.org/show_bug.cgi?id=229668) involved detached-canvas image retention and was fixed in 2021. Our canvas is detached and retained after Stop, but we have no memory-growth trace, crash, or matching phone/browser version. These reports justify measurement, not a claim that our phone has those bugs.
5. **Recent blur bug — different symptom.** [WebKit bug 322045](https://bugs.webkit.org/show_bug.cgi?id=322045), marked NEW when checked, concerns first-frame/navigation stalls with blur plus painted SVG. Our reported problem is sustained choppy camera motion. It is not an established match.
6. **Frame-rate constraint bug — different request shape.** [WebKit bug 261461](https://bugs.webkit.org/show_bug.cgi?id=261461) concerns maximum frame-rate constraints; it is marked FIXED, with later user reports. Our front 4K attempts use minimum/ideal rates without a maximum. This does not establish why our 4K grant was 30.

The research did not establish a universal Safari ban on 4K60. Phone model, iOS/Safari version, compatible capture modes, lighting/power state, and a minimal same-device result are still needed before calling the requested quality impossible.

## Exact code paths for Claude

- Camera requests and rate guard: `public/app/teleprompter.js:561`, `:587`, `:603`, `:3152`. The below-rate guard reads settings before preview attachment; preserve each attempt's constraints, returned settings, rejection/error reason, and ready-preview settings before deciding whether this timing matters.
- Native preview attachment: `public/app/teleprompter.js:3027`. Preview is a video element, not a continuously copied app canvas.
- Preview effects: `public/app/teleprompter.css:192`, `:534`, and the visible glass-control backdrop rules.
- Stable recording canvas: `public/app/teleprompter.js:2685`. Copies use a mirrored full-frame draw; preview CSS blur is not burned into the video.
- Callback accounting and copy/capture timing: `public/app/teleprompter.js:2759`, `:2783`. The next callback is registered after copy work finishes. Timings combine draw and requestFrame.
- Queue and sequential upload: `public/app/teleprompter.js:3487`, `:3529`; store in `public/app/teleprompter-take-store.js`. TWO queued means one sequential upload can be active while another waits. It does not mean two encoders. Upload/storage work can overlap preview/filming; its cost was not measured.
- Raw upload forwarding: `src/marketing/take-upload.mjs:280`. This path forwards original chunks without re-encoding. The near-equal copied/encoded counts argue against major loss after drawing, but encoder backpressure could still affect earlier work.

## Smallest next check

First take a passive 10-second performance trace of the **physical iPhone's idle 4K preview**: actual settings, frame callbacks/presented deltas/display lateness, rendering/main-thread work, script Play state, and existing upload activity. Add no extra drawing canvas. Compare naturally active versus completed queue work without interrupting queued recordings. This can distinguish preview load from a recording-only problem.

Read-only Xcode discovery listed two paired physical iPhones alongside simulators. Process inspection failed: one phone reports Developer Mode disabled, and the other cannot fulfill the requested usage assertion. No performance trace was collected. A separate Web Inspector tool was tried, but its USB device lookup found neither listed hardware identifier. No phone URL was opened, device setting changed, or saved take interrupted. These failures are access limits rather than evidence that the owner left the phone locked.

If that trace is insufficient, use an isolated same-phone probe to compare bare native video, the styled preview, native-stream recording, and canvas recording, adding one stage at a time. Keep resolution/orientation/settings consistent and measure original outputs. Record draw and requestFrame costs separately. Preserve the production screen, real queued files, and continuous one-file lens behavior.

Interpretation: smooth bare video with a choppy styled preview implicates rendering effects; smooth preview/native recording with choppy canvas output implicates the canvas path; choppy bare video leaves capture/browser conditions unresolved. Collect every 60 fps negotiation result to separate unsupported combinations from app rejection/timing. Desktop mocks cannot close these phone-specific checks.

**Handoff instruction:** Continue from these measurements and the isolated GPU candidate. Prove the candidate on the real phone before calling it fixed. Do not claim a known WebKit bug or hardware limit merely because its description sounds similar.
