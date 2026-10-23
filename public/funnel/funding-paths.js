/* public/funnel/funding-paths.js
 * "What happens after you book" + UnderwriteIQ analysis panel + three animated path widgets (funding in rounds,
 * optimize then fund, step-by-step plan). Owner-approved preview 2026-09-30.
 *
 * Load on /watch and /thank-you:  <script src="https://fundhub.ai/funnel/funding-paths.js" defer></script>
 *   /watch      -> inserted right after the approvals/testimonials section (#fh-watch-proof),
 *                  with the Get Started button (links to /apply).
 *   /thank-you  -> inserted right after the app card slot (#fh-ty-app-slot, owner reorder 2026-10-23),
 *                  or after .expect on a page without the slot,
 *                  kicker/sub reworded for someone already booked, no CTA button.
 * All CSS is scoped under .fhp. Every amount and score is labeled "Sample".
 * Animations start when a card is on screen, stop off screen, and are off under reduced motion.
 */
(function () {
  if (document.getElementById('fhp-root')) return;
  var CSS = "\n\n.fhp{--bg:#FFFFFF; --ink:#0A0A0A; --ink2:#27272A; --gray:#52525B; --gray2:#9C9CA5; --line:#E4E4E7; --panel:#F5F5F6; --track:#E7E7EA; --good:#15803D; --good-bg:#E7F4EC; --warn:#B45309; --warn-bg:#FDF1E1; --bad:#B42318; --bad-bg:#FCEBE9; --mark:255,153,0; --scan:24,139,246; --ai-bg:#FFFFFF; --ai-fg:#0A0A0A; --ai-dim:#71717A; --ai-line:#E4E4E7; --ai-good:#15803D; --ai-warn:#B45309; --sans:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif; --mono:'JetBrains Mono',ui-monospace,Menlo,monospace;max-width:1080px;margin:0 auto;padding-block:56px 8px;text-align:center;container-type:inline-size;font-family:var(--sans);color:var(--ink);-webkit-font-smoothing:antialiased}\n.fhp *{box-sizing:border-box}\n.fhp[data-mode=\"thankyou\"] .fhp-cta{display:none}\n\n/* header */\n.fhp .fhp-kicker{display:block;font-family:var(--mono);font-size:10.5px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--gray2)}\n.fhp .fhp-h{font-size:clamp(24px,3.6vw,34px);font-weight:700;letter-spacing:-.035em;line-height:1.12;margin:12px auto 0;max-width:24ch;text-wrap:balance;color:var(--ink)}\n.fhp .fhp-mark{background-image:linear-gradient(100deg,transparent 1%,rgba(var(--mark),.34) 3%,rgba(var(--mark),.34) 97%,transparent 99%);background-repeat:no-repeat;background-size:100% 42%;background-position:0 88%;padding:0 2px}\n.fhp .fhp-sub{margin:14px auto 0;max-width:56ch;font-size:15.5px;line-height:1.65;color:var(--gray)}\n\n/* after-you-book strip */\n.fhp .fhp-flow{margin:30px auto 0;padding:0;max-width:640px;display:grid;grid-template-columns:repeat(3,1fr);position:relative;overflow-anchor:auto}\n.fhp .fhp-flow::before,.fhp .fhp-flow .fill{content:\"\";position:absolute;top:13px;left:16.66%;height:2px;border-radius:2px}\n.fhp .fhp-flow::before{right:16.66%;background:var(--track)}\n.fhp .fhp-flow .fill{width:0;max-width:66.68%;background:var(--ink);transition:width 1.6s cubic-bezier(.4,0,.2,1)}\n.fhp .fhp-flow.go .fill{width:66.68%}\n.fhp .fhp-flow .st{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:0 6px}\n.fhp .fhp-flow .dot{width:28px;height:28px;border-radius:50%;background:var(--bg);border:2px solid var(--track);display:grid;place-items:center;font-family:var(--mono);font-size:11px;font-weight:600;color:var(--gray2);transition:border-color .3s,background .3s,color .3s;position:relative;z-index:1}\n.fhp .fhp-flow .st.lit .dot{border-color:var(--ink);background:var(--ink);color:#fff}\n.fhp .fhp-flow .t{font-size:13px;font-weight:600;letter-spacing:-.01em;color:var(--ink)}\n.fhp .fhp-flow .d{font-size:12px;line-height:1.45;color:var(--gray);max-width:18ch}\n\n/* keep viewport locked on the flow strip while widgets animate below */\n.fhp{overflow-anchor:none}\n.fhp .fhp-ai,.fhp .fhp-card,.fhp .ai-chip,.fhp .ai-log,.fhp .ai-body,.fhp .ai-prof,.fhp .fhp-stage,.fhp .fhp-grid{overflow-anchor:none}\n\n/* UnderwriteIQ analysis panel */\n.fhp .fhp-ai{position:relative;overflow:hidden;margin-top:30px;text-align:left;background:var(--ai-bg);color:var(--ai-fg);border:1px solid var(--line);border-radius:14px;padding:18px;box-shadow:0 1px 2px rgba(12,12,13,.06),0 10px 24px -14px rgba(12,12,13,.28);min-height:548px;overflow-anchor:none}\n.fhp .ai-scan{position:absolute;left:0;right:0;top:-80px;height:80px;pointer-events:none;background:linear-gradient(180deg,transparent,rgba(var(--scan),.07) 70%,rgba(var(--scan),.20) 100%);opacity:0}\n.fhp .fhp-ai.running .ai-scan{opacity:1;animation:aiScan 2.4s linear infinite}\n@keyframes aiScan{from{transform:translateY(0)}to{transform:translateY(calc(100% + 520px))}}\n.fhp .ai-head{position:relative;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px 14px}\n.fhp .ai-name{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--ai-fg)}\n.fhp .ai-dot{width:7px;height:7px;border-radius:50%;background:var(--ai-good)}\n.fhp .fhp-ai.running .ai-dot{background:rgb(var(--scan));animation:aiPulse 1.2s ease-out infinite}\n@keyframes aiPulse{0%{box-shadow:0 0 0 0 rgba(var(--scan),.55)}100%{box-shadow:0 0 0 8px rgba(var(--scan),0)}}\n.fhp .ai-status{font-family:var(--mono);font-size:11px;color:var(--ai-dim)}\n.fhp .ai-prof{position:relative;display:flex;flex-wrap:wrap;align-items:center;align-content:flex-start;gap:6px;margin-top:12px;min-height:30px;overflow-anchor:none}\n.fhp .ai-chip{display:inline-flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:11px;font-weight:500;line-height:1.2;padding:5px 10px;border-radius:99px;background:var(--panel);color:var(--ink2);border:1px solid var(--line);animation:aiChip .35s ease-out both;overflow-anchor:none;white-space:nowrap}\n.fhp .ai-chip.bad{background:var(--warn-bg);color:var(--warn);border-color:transparent}\n@keyframes aiChip{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}\n.fhp .ai-files{display:flex;gap:4px;align-items:center}\n.fhp .ai-files button{font:600 11px/1 var(--mono);width:28px;height:28px;border-radius:8px;border:1px solid var(--line);background:#FFFFFF;color:var(--gray);cursor:pointer;transition:background .2s,color .2s,border-color .2s}\n.fhp .ai-files button:hover{border-color:var(--ink);color:var(--ink)}\n.fhp .ai-files button[aria-pressed=\"true\"]{background:var(--ink);border-color:var(--ink);color:#FFFFFF}\n.fhp .ai-files button:focus-visible{outline:2px solid rgba(var(--mark),.8);outline-offset:2px}\n.fhp .ai-go{margin-top:4px;padding:0;border:0;background:none;font:600 13px/1.3 var(--sans);color:var(--ink);text-decoration:underline;text-underline-offset:3px;cursor:pointer}\n.fhp .ai-go:focus-visible{outline:2px solid rgba(var(--mark),.8);outline-offset:2px}\n@container (min-width:880px){.fhp .ai-go{display:none}}\n.fhp .ai-right{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}\n.fhp .ai-body{position:relative;display:grid;grid-template-columns:1fr;gap:16px;margin-top:14px;min-height:300px;overflow-anchor:none}\n@container (min-width:680px){.fhp .ai-body{grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:24px;min-height:228px}}\n.fhp .ai-log{list-style:none;margin:0;padding:0;min-width:0;min-height:268px;overflow-anchor:none}\n.fhp .ai-log li{display:grid;grid-template-columns:16px minmax(0,1fr) auto;column-gap:10px;align-items:baseline;padding:7px 0;border-top:1px solid var(--ai-line);font-family:var(--mono);font-size:12px;line-height:1.45;color:var(--ai-fg);opacity:.3;transition:opacity .25s}\n.fhp .ai-log li:first-child{border-top:0}\n.fhp .ai-log li.run,.fhp .ai-log li.ok,.fhp .ai-log li.flag{opacity:1}\n.fhp .lg-ic{font-weight:600;color:var(--ai-dim)}\n.fhp .ai-log li.run .lg-ic{color:rgb(var(--scan))}\n.fhp .ai-log li.ok .lg-ic{color:var(--ai-good)}\n.fhp .ai-log li.flag .lg-ic{color:var(--ai-warn)}\n.fhp .lg-r{text-align:right;white-space:nowrap;color:var(--ai-dim)}\n.fhp .ai-log li.ok .lg-r{color:var(--ai-good)}\n.fhp .ai-log li.flag .lg-r{color:var(--ai-warn)}\n@container (max-width:520px){.fhp .lg-r{grid-column:2;text-align:left;white-space:normal;margin-top:2px}.fhp .ai-log{min-height:348px}.fhp .fhp-ai{min-height:628px}.fhp .ai-log li{min-height:46px}.fhp .ai-prof{min-height:58px}}\n.fhp .ai-out{display:flex;flex-direction:row;align-items:center;gap:16px;min-width:0;padding:14px;border-radius:10px;background:var(--panel)}\n@container (min-width:680px){.fhp .ai-out{flex-direction:column;align-items:flex-start;justify-content:center}}\n.fhp .ai-ring{flex:0 0 96px;width:96px;position:relative}\n.fhp .ai-ring svg{display:block;width:100%;height:auto}\n.fhp .ai-pct{position:absolute;inset:0;display:grid;place-items:center;align-content:center;text-align:center}\n.fhp .ai-pct b{font-size:24px;font-weight:700;letter-spacing:-.03em;line-height:1;color:var(--ai-fg)}\n.fhp .ai-pct span{margin-top:3px;font-family:var(--mono);font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ai-dim)}\n.fhp .ai-stats{display:flex;flex-direction:column;gap:10px;min-width:0}\n.fhp .ai-k{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ai-dim)}\n.fhp .ai-v{display:block;margin-top:3px;font-size:17px;font-weight:700;letter-spacing:-.02em;line-height:1.2;color:var(--ai-fg)}\n.fhp .ai-note{margin:12px 0 0;position:relative;font-size:12px;line-height:1.5;color:var(--ai-dim)}\n\n/* recommended card from the analysis */\n.fhp .fhp-card{position:relative;transition:box-shadow .35s,border-color .35s;min-height:432px;overflow-anchor:none}\n.fhp .fhp-card.rec{border-color:var(--ink);box-shadow:0 0 0 1px var(--ink),0 14px 30px -14px rgba(12,12,13,.4)}\n.fhp .rec-badge{position:absolute;top:-11px;right:14px;font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#FFFFFF;background:var(--ink);border-radius:99px;padding:5px 9px;opacity:0;transform:translateY(4px);transition:opacity .3s,transform .3s;pointer-events:none}\n.fhp .fhp-card.rec .rec-badge{opacity:1;transform:none}\n\n/* cards */\n.fhp .fhp-grid{display:grid;grid-template-columns:1fr;gap:16px;margin-top:32px;text-align:left}\n@container (min-width:880px){.fhp .fhp-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.fhp .fhp-card{min-height:468px}}\n@container (min-width:600px) and (max-width:879.98px){.fhp .fhp-card{grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);grid-template-rows:auto 1fr;column-gap:22px}.fhp .fhp-card header{grid-column:1;grid-row:1}.fhp .fhp-stage{grid-column:2;grid-row:1 / span 2}.fhp .fhp-foot{grid-column:1;grid-row:2;align-self:end}}\n.fhp .fhp-card{min-width:0;display:grid;grid-template-rows:auto 1fr auto;gap:14px;background:#FFFFFF;border:1px solid var(--line);border-radius:14px;padding:18px;box-shadow:0 1px 2px rgba(12,12,13,.06),0 10px 24px -14px rgba(12,12,13,.28)}\n.fhp .fhp-tag{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:10.5px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--gray)}\n.fhp .fhp-tag b{flex:0 0 auto;white-space:nowrap;font-weight:600;color:#FFFFFF;background:var(--ink);border-radius:5px;padding:3px 6px;letter-spacing:.1em}\n.fhp .fhp-card h3{margin:10px 0 0;font-size:19px;font-weight:700;letter-spacing:-.025em;line-height:1.2;color:var(--ink)}\n.fhp .fhp-card header p{margin:6px 0 0;font-size:14px;line-height:1.6;color:var(--gray)}\n.fhp .fhp-stage{background:var(--panel);border-radius:10px;padding:14px;min-width:0;align-self:start;min-height:236px;overflow-anchor:none}\n.fhp .fhp-label{font-family:var(--mono);font-size:10px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--gray2)}\n.fhp .fhp-foot{margin:0;font-size:13px;line-height:1.5;color:var(--ink2);display:flex;gap:8px;align-items:flex-start}\n.fhp .fhp-foot::before{content:\"\";flex:0 0 6px;height:6px;margin-top:7px;border-radius:50%;background:var(--ink)}\n.fhp .num{font-variant-numeric:tabular-nums}\n\n/* path 1: funding rounds */\n.fhp .s1-top{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;padding-bottom:10px}\n.fhp .s1-total{font-size:26px;font-weight:700;letter-spacing:-.03em;line-height:1;color:var(--ink)}\n.fhp .s1-row{display:grid;grid-template-columns:58px minmax(0,1fr) auto;column-gap:10px;row-gap:5px;align-items:center;padding:8px 0;border-top:1px solid var(--line);min-height:44px}\n.fhp .s1-r{font-family:var(--mono);font-size:11px;color:var(--gray)}\n.fhp .s1-track{height:10px;background:var(--track);border-radius:99px;overflow:hidden}\n.fhp .s1-bar{height:100%;width:0;background:var(--ink);border-radius:99px;transition:width .7s cubic-bezier(.4,0,.2,1)}\n.fhp .s1-amt{font-size:13px;font-weight:600;min-width:62px;text-align:right;color:var(--ink)}\n.fhp .s1-chip{grid-column:2 / 4;justify-self:start;font-size:11px;font-weight:500;line-height:1;padding:4px 8px;border-radius:99px;visibility:hidden;min-height:22px;transition:background .3s,color .3s}\n.fhp .s1-chip.inq{visibility:visible;background:var(--bad-bg);color:var(--bad)}\n.fhp .s1-chip.clean{visibility:visible;background:var(--good-bg);color:var(--good)}\n\n/* path 2: optimize */\n.fhp .s2-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:6px}\n.fhp .s2-gauge{width:132px;flex:0 0 132px}\n.fhp .s2-gauge svg{display:block;width:100%;height:auto}\n.fhp .s2-side{display:flex;flex-direction:column;align-items:flex-end;gap:8px;text-align:right}\n.fhp .pill{font-size:11.5px;font-weight:600;line-height:1;padding:6px 10px;border-radius:99px;transition:background .3s,color .3s}\n.fhp .pill.warn{background:var(--warn-bg);color:var(--warn)}\n.fhp .pill.ok{background:var(--good-bg);color:var(--good)}\n.fhp .s2-list{list-style:none;margin:0;padding:0}\n.fhp .s2-list li{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:13.5px;color:var(--ink2)}\n.fhp .s2-list .lbl{flex:1;min-width:0}\n.fhp .ic{flex:0 0 18px;width:18px;height:18px;border-radius:50%;border:1.5px solid var(--warn);display:grid;place-items:center;transition:background .3s,border-color .3s}\n.fhp .ic svg{width:10px;height:10px;opacity:0;transition:opacity .2s}\n.fhp .s2-list li.ok .ic{background:var(--good);border-color:var(--good)}\n.fhp .s2-list li.ok .ic svg{opacity:1}\n.fhp .val{font-family:var(--mono);font-size:12px;display:flex;gap:6px;align-items:baseline}\n.fhp .val .old{color:var(--warn);font-weight:600}\n.fhp .val .new{display:none;color:var(--good);font-weight:600}\n.fhp li.ok .val .old{color:var(--gray2);font-weight:500;text-decoration:line-through}\n.fhp li.ok .val .new{display:inline}\n\n/* path 3: step-by-step plan */\n.fhp .s3-meter{padding-bottom:12px}\n.fhp .s3-row{display:flex;justify-content:space-between;align-items:flex-end;gap:10px}\n.fhp .s3-val{font-size:24px;font-weight:700;letter-spacing:-.03em;line-height:1;color:var(--ink)}\n.fhp .s3-track{margin-top:10px;height:8px;background:var(--track);border-radius:99px;overflow:hidden}\n.fhp .s3-fill{height:100%;width:25%;background:var(--ink);border-radius:99px;transition:width .7s cubic-bezier(.4,0,.2,1)}\n.fhp .s3-scale{display:flex;justify-content:space-between;margin-top:6px;font-family:var(--mono);font-size:10.5px;color:var(--gray2)}\n.fhp .s3-steps{list-style:none;margin:0;padding:0}\n.fhp .s3-steps li{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:13.5px;color:var(--gray2);transition:color .3s}\n.fhp .s3-steps .n{flex:0 0 20px;width:20px;height:20px;border-radius:50%;border:1.5px solid var(--track);display:grid;place-items:center;font-family:var(--mono);font-size:10px;font-weight:600;color:var(--gray2);transition:all .3s}\n.fhp .s3-steps .n svg{display:none;width:10px;height:10px}\n.fhp .s3-steps li .now{display:none;margin-left:auto;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink)}\n.fhp .s3-steps li.active{color:var(--ink)}\n.fhp .s3-steps li.active .n{border-color:var(--ink);color:var(--ink)}\n.fhp .s3-steps li.active .now{display:inline}\n.fhp .s3-steps li.done{color:var(--ink2)}\n.fhp .s3-steps li.done .n{background:var(--good);border-color:var(--good)}\n.fhp .s3-steps li.done .n span{display:none}\n.fhp .s3-steps li.done .n svg{display:block}\n\n/* CTA */\n.fhp .fhp-cta{margin-top:32px;display:flex;flex-direction:column;align-items:center;gap:10px}\n.fhp .fhp-btn{display:inline-block;background:#188bf6;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:600;letter-spacing:-.01em;padding:16px 34px;border-radius:10px;box-shadow:0 5px 18px rgba(24,139,246,.28);transition:background .15s,transform .15s}\n.fhp .fhp-btn:hover{background:#0b78dd;transform:translateY(-1px)}\n.fhp .fhp-btn:focus-visible{outline:3px solid rgba(var(--mark),.8);outline-offset:3px}\n.fhp .fhp-note{font-family:var(--mono);font-size:11px;color:var(--gray)}\n\n.fh-root .fhp{padding-block:56px 8px}\n@media(max-width:420px){\n  .fh-root .fhp{padding-block:44px 4px}\n  .fhp .fhp-card{padding:16px}\n  .fhp .s2-gauge{width:116px;flex-basis:116px}\n}\n@media(prefers-reduced-motion:reduce){\n  .fhp *{transition:none!important}\n  .fhp .fhp-ai .ai-scan,.fhp .fhp-ai .ai-dot,.fhp .fhp-ai .ai-chip{animation:none!important}\n}\n";
  var HTML = "<section class=\"fhp\" aria-labelledby=\"fhp-title\"> <span class=\"fhp-kicker\">What happens after you book</span> <h2 class=\"fhp-h\" id=\"fhp-title\">Your file decides <span class=\"fhp-mark\">where you start</span></h2> <p class=\"fhp-sub\">On the call, your advisor runs a tri-bureau soft pull plus an Experian business report with you. What your file shows puts you on one of these three paths.</p> <div class=\"fhp-flow\" id=\"fhp-flow\" role=\"list\" aria-label=\"Steps after you book\"> <span class=\"fill\" aria-hidden=\"true\"></span> <div class=\"st\" role=\"listitem\"><span class=\"dot\">1</span><span class=\"t\">Apply</span><span class=\"d\">10-second application</span></div> <div class=\"st\" role=\"listitem\"><span class=\"dot\">2</span><span class=\"t\">Your call</span><span class=\"d\">Soft pull with your advisor</span></div> <div class=\"st\" role=\"listitem\"><span class=\"dot\">3</span><span class=\"t\">Your path</span><span class=\"d\">Where your file fits today</span></div> </div> <div class=\"fhp-ai\" id=\"fhp-ai\" aria-label=\"UnderwriteIQ analysis of a sample file\"> <span class=\"ai-scan\" aria-hidden=\"true\"></span> <div class=\"ai-head\"> <span class=\"ai-name\"><i class=\"ai-dot\"></i>UnderwriteIQ analysis</span> <span class=\"ai-right\"><span class=\"ai-status\" id=\"fhp-ai-status\">Analysis complete \u00b7 Sample file A</span><span class=\"ai-files\" id=\"fhp-ai-files\" role=\"group\" aria-label=\"Pick a sample file\"></span></span> </div> <div class=\"ai-prof\" id=\"fhp-ai-prof\" aria-label=\"Sample file profile\"></div> <div class=\"ai-body\"> <ol class=\"ai-log\" id=\"fhp-ai-log\"></ol> <div class=\"ai-out\"> <div class=\"ai-ring\"> <svg viewBox=\"0 0 100 100\" aria-hidden=\"true\"> <circle cx=\"50\" cy=\"50\" r=\"42\" fill=\"none\" stroke-width=\"8\" style=\"stroke:var(--track)\"></circle> <circle id=\"fhp-ai-arc\" cx=\"50\" cy=\"50\" r=\"42\" fill=\"none\" stroke-width=\"8\" stroke-linecap=\"round\" pathLength=\"100\" stroke-dasharray=\"86 100\" transform=\"rotate(-90 50 50)\" style=\"stroke:var(--ai-good);transition:stroke .3s\"></circle> </svg> <div class=\"ai-pct\"><b class=\"num\" id=\"fhp-ai-pct\">86%</b><span>Readiness</span></div> </div> <div class=\"ai-stats\"> <div><span class=\"ai-k\">Lenders that fit</span><span class=\"ai-v num\" id=\"fhp-ai-lenders\">42</span></div> <div><span class=\"ai-k\">Where this file fits today</span><span class=\"ai-v\" id=\"fhp-ai-path\">Path 1 \u00b7 Funding in rounds</span><button type=\"button\" class=\"ai-go\" id=\"fhp-ai-go\">See this path</button></div> </div> </div> </div> <p class=\"ai-note\">Sample files. On your call, UnderwriteIQ runs this on your own file with your advisor. Path 3 is open to anyone who'd rather do the work themselves, whatever the file shows.</p> </div> <div class=\"fhp-grid\"> <!-- PATH 1 --> <article class=\"fhp-card\" id=\"fhp-p1\"> <span class=\"rec-badge\">Best fit for sample file A</span> <header> <span class=\"fhp-tag\"><b>Path 1</b> Your file is ready</span> <h3>Funding in rounds</h3> <p>UnderwriteIQ matches your file to the 30 to 50 lenders that fit it. We apply in rounds and remove the new inquiries before the next round goes out, so every round starts clean.</p> </header> <div class=\"fhp-stage\"> <div class=\"s1-top\"> <span class=\"fhp-label\">Sample funding sequence</span> <span class=\"s1-total num\" id=\"fhp-s1-total\">$318,000</span> </div> <div id=\"fhp-s1-rows\"></div> </div> <p class=\"fhp-foot\">Your first applications go out within 72 business hours.</p> </article> <!-- PATH 2 --> <article class=\"fhp-card\" id=\"fhp-p2\"> <span class=\"rec-badge\">Best fit for sample file A</span> <header> <span class=\"fhp-tag\"><b>Path 2</b> Something is holding you back</span> <h3>Optimize, then fund</h3> <p>We show you exactly what's holding your file back, optimize your credit for you, and fund you once your file is ready.</p> </header> <div class=\"fhp-stage\"> <div class=\"s2-top\"> <div class=\"s2-gauge\"> <svg viewBox=\"0 0 132 80\" role=\"img\" aria-label=\"Sample credit score\"> <path d=\"M12 70 A54 54 0 0 1 120 70\" fill=\"none\" style=\"stroke:var(--track)\" stroke-width=\"10\" stroke-linecap=\"round\" pathLength=\"100\"></path> <path id=\"fhp-s2-arc\" d=\"M12 70 A54 54 0 0 1 120 70\" fill=\"none\" stroke-width=\"10\" stroke-linecap=\"round\" pathLength=\"100\" stroke-dasharray=\"77 100\" style=\"stroke:var(--good);transition:stroke-dasharray .6s cubic-bezier(.4,0,.2,1),stroke .3s\"></path> <text id=\"fhp-s2-score\" x=\"66\" y=\"64\" text-anchor=\"middle\" font-family=\"Inter, system-ui, sans-serif\" font-size=\"24\" font-weight=\"700\" letter-spacing=\"-0.5\" style=\"fill:var(--ink);font-variant-numeric:tabular-nums\">724</text> </svg> </div> <div class=\"s2-side\"> <span class=\"pill ok\" id=\"fhp-s2-pill\">Ready for funding</span> <span class=\"fhp-label\">Sample file</span> </div> </div> <ul class=\"s2-list\" id=\"fhp-s2-list\"></ul> </div> <p class=\"fhp-foot\">Once your file is ready, you move to funding.</p> </article> <!-- PATH 3 --> <article class=\"fhp-card\" id=\"fhp-p3\"> <span class=\"rec-badge\">Best fit for sample file A</span> <header> <span class=\"fhp-tag\"><b>Path 3</b> You'd rather do it yourself</span> <h3>Your step-by-step plan</h3> <p>You get the exact steps in the right order, help setting up your companies, and a detailed accountability system that walks you through every step.</p> </header> <div class=\"fhp-stage\"> <div class=\"s3-meter\"> <div class=\"s3-row\"> <span class=\"fhp-label\">Funding you can qualify for</span> <span class=\"s3-val num\" id=\"fhp-s3-val\">$400,000</span> </div> <div class=\"s3-track\"><div class=\"s3-fill\" id=\"fhp-s3-fill\" style=\"width:100%\"></div></div> <div class=\"s3-scale\"><span>Sample file</span><span>$400K</span></div> </div> <ol class=\"s3-steps\" id=\"fhp-s3-steps\"></ol> </div> <p class=\"fhp-foot\">When your file is ready, we go get the funding with you, or you can do it yourself.</p> </article> </div> <div class=\"fhp-cta\"> <a class=\"fhp-btn\" href=\"/apply\" id=\"fhp-cta\">Get Started</a> <span class=\"fhp-note\">10-second application \u00b7 Soft pull \u00b7 Zero score impact</span> </div> </section>";

  var onThankYou = /thank-?you/i.test(location.pathname);
  /* Thank-you visitors already applied, so step 1 there is the Fundhub Portal app (Chris, 2026-10-23). */
  var PORTAL_APP_URL = 'https://apps.apple.com/us/app/fundhub-portal/id6823985032';
  function findAnchor() {
    if (onThankYou) {
      /* Under the app card, which fills #fh-ty-app-slot after "Before we talk". */
      var slot = document.getElementById('fh-ty-app-slot');
      if (slot) return slot;
      var proof = document.getElementById('fh-proof');
      return proof && !proof.hidden ? proof : document.querySelector('.fh-root .expect');
    }
    return document.getElementById('fh-watch-proof') || document.querySelector('.fh-root .cta-note');
  }

  function mount() {
    var a = findAnchor();
    if (a && (onThankYou || a.id === 'fh-watch-proof')) { place(a); return; }
    /* The approvals section is injected by another script; wait for it, fall back after 6s. */
    var done = false;
    var obs = new MutationObserver(function () {
      var el = findAnchor();
      if (el && (onThankYou || el.id === 'fh-watch-proof') && !done) { done = true; obs.disconnect(); place(el); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () {
      if (done) return;
      done = true; obs.disconnect();
      var el = findAnchor();
      if (el) place(el);
    }, 6000);
  }

  function place(anchor) {
    if (document.getElementById('fhp-root')) return;
    var font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=optional';
    document.head.appendChild(font);
    var st = document.createElement('style');
    st.id = 'fhp-css';
    st.textContent = CSS;
    document.head.appendChild(st);

    var wrap = document.createElement('div');
    wrap.id = 'fhp-root';
    wrap.innerHTML = HTML;
    var sec = wrap.firstChild;
    if (onThankYou) {
      sec.setAttribute('data-mode', 'thankyou');
      sec.querySelector('.fhp-kicker').textContent = 'Your three paths';
      sec.querySelector('.fhp-sub').textContent = 'What your file shows on the call puts you on one of these three paths. Nobody gets turned away.';
      /* Fundhub is not the lender (this page's FAQ and footer). */
      sec.querySelector('#fhp-p2 header p').textContent = 'We show you exactly what\'s holding your file back and optimize your credit for you.';
      var first = sec.querySelector('.fhp-flow .st');
      first.querySelector('.t').innerHTML = '<a href="' + PORTAL_APP_URL + '" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;text-underline-offset:3px">Get the app</a>';
      first.querySelector('.d').textContent = 'Fundhub Portal for iPhone';
    }
    anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    run();
  }

  function run() {
  var CHECK = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.4l2.3 2.3 4.7-5" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fmt = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
  var ease = function (t) { return 1 - Math.pow(1 - t, 3); };
  function $(id) { return document.getElementById(id); }
  function wait(ms, tok) {
    return new Promise(function (res, rej) { setTimeout(function () { tok.dead ? rej('stop') : res(); }, ms); });
  }
  function tween(from, to, ms, set, tok) {
    return new Promise(function (res, rej) {
      var t0 = null;
      function step(ts) {
        if (tok.dead) { rej('stop'); return; }
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / ms);
        set(from + (to - from) * ease(p));
        p < 1 ? requestAnimationFrame(step) : res();
      }
      requestAnimationFrame(step);
    });
  }

  /* ---------- PATH 1: funding rounds ---------- */
  var ROUNDS = [
    { inq: 6, amt: 86000 },
    { inq: 5, amt: 81000 },
    { inq: 5, amt: 77000 },
    { inq: 4, amt: 74000 }
  ];
  var MAX1 = 86000;
  var rowsBox = $('fhp-s1-rows');
  var rows = ROUNDS.map(function (r, i) {
    var row = document.createElement('div');
    row.className = 's1-row';
    row.innerHTML = '<span class="s1-r">Round ' + (i + 1) + '</span>' +
      '<div class="s1-track"><div class="s1-bar"></div></div>' +
      '<span class="s1-amt num">&mdash;</span>' +
      '<span class="s1-chip"></span>';
    rowsBox.appendChild(row);
    return { bar: row.querySelector('.s1-bar'), amt: row.querySelector('.s1-amt'), chip: row.querySelector('.s1-chip'), r: r };
  });
  function p1Final() {
    $('fhp-s1-total').textContent = fmt(ROUNDS.reduce(function (s, r) { return s + r.amt; }, 0));
    rows.forEach(function (o) {
      o.bar.style.width = (o.r.amt / MAX1 * 100) + '%';
      o.amt.textContent = fmt(o.r.amt);
      o.chip.className = 's1-chip clean';
      o.chip.textContent = o.r.inq + ' inquiries removed';
    });
  }
  function p1Reset() {
    $('fhp-s1-total').textContent = '$0';
    rows.forEach(function (o) {
      o.bar.style.width = '0%';
      o.amt.innerHTML = '&mdash;';
      o.chip.className = 's1-chip';
      o.chip.textContent = '';
    });
  }
  async function p1Run(tok) {
    p1Reset();
    await wait(600, tok);
    var sum = 0;
    for (var i = 0; i < rows.length; i++) {
      var o = rows[i];
      o.bar.style.width = (o.r.amt / MAX1 * 100) + '%';
      var start = sum;
      await Promise.all([
        tween(0, o.r.amt, 700, function (v) { o.amt.textContent = fmt(v); }, tok),
        tween(start, start + o.r.amt, 700, function (v) { $('fhp-s1-total').textContent = fmt(v); }, tok)
      ]);
      sum += o.r.amt;
      o.chip.className = 's1-chip inq';
      o.chip.textContent = '+' + o.r.inq + ' new inquiries';
      await wait(950, tok);
      o.chip.className = 's1-chip clean';
      o.chip.textContent = o.r.inq + ' inquiries removed';
      await wait(650, tok);
    }
    await wait(2800, tok);
  }

  /* ---------- PATH 2: optimize ---------- */
  var ITEMS = [
    ['Hard inquiries', '9', '0'],
    ['Outdated personal data', '3', '0'],
    ['Negative items', '2', '0'],
    ['Utilization', '68%', '9%']
  ];
  var S_START = 612, S_END = 724;
  var list2 = $('fhp-s2-list');
  var items = ITEMS.map(function (it) {
    var li = document.createElement('li');
    li.innerHTML = '<span class="ic">' + CHECK + '</span><span class="lbl">' + it[0] + '</span>' +
      '<span class="val"><span class="old">' + it[1] + '</span><span class="new">' + it[2] + '</span></span>';
    list2.appendChild(li);
    return li;
  });
  function setScore(s) {
    var pct = (s - 300) / 550 * 100;
    $('fhp-s2-arc').setAttribute('stroke-dasharray', pct.toFixed(2) + ' 100');
    $('fhp-s2-score').textContent = Math.round(s);
  }
  function setPill(ok) {
    var p = $('fhp-s2-pill');
    p.className = 'pill ' + (ok ? 'ok' : 'warn');
    p.textContent = ok ? 'Ready for funding' : 'Needs optimization';
    $('fhp-s2-arc').style.stroke = ok ? 'var(--good)' : 'var(--ink)';
  }
  function p2Final() { items.forEach(function (li) { li.className = 'ok'; }); setScore(S_END); setPill(true); }
  function p2Reset() { items.forEach(function (li) { li.className = ''; }); setScore(S_START); setPill(false); }
  async function p2Run(tok) {
    p2Reset();
    await wait(700, tok);
    var stepSize = (S_END - S_START) / items.length;
    for (var i = 0; i < items.length; i++) {
      items[i].className = 'ok';
      var from = S_START + stepSize * i;
      await tween(from, from + stepSize, 650, setScore, tok);
      await wait(700, tok);
    }
    setPill(true);
    await wait(3000, tok);
  }

  /* ---------- PATH 3: step-by-step plan ---------- */
  var STEPS = [
    'Pay down balances in the right order',
    'Fix how your companies are set up',
    'Open or age companies',
    'Mail your optimization letters',
    'File ready for funding'
  ];
  var VALS = [100000, 130000, 180000, 250000, 320000, 400000];
  var MAX3 = 400000;
  var list3 = $('fhp-s3-steps');
  var steps = STEPS.map(function (s, i) {
    var li = document.createElement('li');
    li.innerHTML = '<span class="n"><span>' + (i + 1) + '</span>' + CHECK + '</span><span>' + s + '</span><span class="now">In progress</span>';
    list3.appendChild(li);
    return li;
  });
  function setMeter(v) {
    $('fhp-s3-val').textContent = fmt(v);
    $('fhp-s3-fill').style.width = (v / MAX3 * 100) + '%';
  }
  function p3Final() { steps.forEach(function (li) { li.className = 'done'; }); setMeter(MAX3); }
  function p3Reset() { steps.forEach(function (li, i) { li.className = i === 0 ? 'active' : ''; }); setMeter(VALS[0]); }
  async function p3Run(tok) {
    p3Reset();
    await wait(700, tok);
    for (var i = 0; i < steps.length; i++) {
      steps[i].className = 'active';
      await wait(800, tok);
      steps[i].className = 'done';
      await tween(VALS[i], VALS[i + 1], 650, setMeter, tok);
      await wait(250, tok);
    }
    await wait(3000, tok);
  }

  /* ---------- UnderwriteIQ analysis (two sample files, alternating) ---------- */
  var LOG = [
    'Pulling Experian, Equifax, TransUnion and Experian Business',
    'Reviewing the file the way a lender does',
    'Checking personal data across all three bureaus',
    'Checking business codes',
    'Counting recent hard inquiries',
    'Matching against thousands of lenders',
    'Comparing to thousands of past approvals'
  ];
  /* Five sample situations. prof: [label, flagged?]. res: one [state, text] per LOG line. */
  var SAMPLES = [
    { name: 'Sample file A', pct: 86, lenders: 42, path: 'Path 1 · Funding in rounds', card: 'p1',
      prof: [['Score 741', 0], ['2 inquiries', 0], ['Utilization 12%', 0], ['Business 3 yrs', 0]],
      res: [['ok', '4 reports'], ['ok', 'Done'], ['ok', 'Consistent'], ['ok', 'Clear'], ['ok', '2'], ['ok', '42 fit'], ['ok', 'Strong match']] },
    { name: 'Sample file B', pct: 41, lenders: 9, path: 'Path 2 · Optimize, then fund', card: 'p2',
      prof: [['Score 618', 1], ['11 inquiries', 1], ['Utilization 64%', 1], ['Business 8 mo', 0]],
      res: [['ok', '4 reports'], ['ok', 'Done'], ['flag', '2 outdated addresses'], ['flag', 'Flagged by 6 lenders'], ['flag', '11'], ['flag', '9 fit'], ['flag', 'Optimize first']] },
    { name: 'Sample file C', pct: 94, lenders: 48, path: 'Path 1 · Maximum funding in rounds', card: 'p1',
      prof: [['Score 786', 0], ['1 inquiry', 0], ['Utilization 4%', 0], ['Business 6 yrs', 0]],
      res: [['ok', '4 reports'], ['ok', 'Done'], ['ok', 'Consistent'], ['ok', 'Clear'], ['ok', '1'], ['ok', '48 fit'], ['ok', 'Top-tier match']] },
    { name: 'Sample file D', pct: 58, lenders: 17, path: 'Path 2 · Optimize, then fund', card: 'p2',
      prof: [['Score 692', 0], ['4 inquiries', 0], ['Utilization 78%', 1], ['Business 2 yrs', 0]],
      res: [['ok', '4 reports'], ['ok', 'Done'], ['ok', 'Consistent'], ['ok', 'Clear'], ['ok', '4'], ['flag', '17 fit'], ['flag', 'Pay down balances first']] },
    { name: 'Sample file E', pct: 79, lenders: 31, path: 'Path 1 · Personal funding in rounds', card: 'p1',
      prof: [['Score 728', 0], ['3 inquiries', 0], ['Utilization 18%', 0], ['No business yet', 0]],
      res: [['ok', '3 reports'], ['ok', 'Done'], ['ok', 'Consistent'], ['ok', 'Personal funding only'], ['ok', '3'], ['ok', '31 fit'], ['ok', 'Good match']] }
  ];
  var aiBox = $('fhp-ai');
  var logBox = $('fhp-ai-log');
  var logLis = LOG.map(function (t) {
    var li = document.createElement('li');
    li.innerHTML = '<span class="lg-ic">·</span><span class="lg-t">' + t + '</span><span class="lg-r"></span>';
    logBox.appendChild(li);
    return li;
  });
  var cardEls = { p1: $('fhp-p1'), p2: $('fhp-p2'), p3: $('fhp-p3') };
  var aiIdx = 0;      /* next sample the loop will run */
  var aiShown = 0;    /* sample whose result is on screen */
  var fileBox = $('fhp-ai-files');
  var fileBtns = SAMPLES.map(function (sm, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = sm.name.slice(-1);
    b.setAttribute('aria-label', 'Run ' + sm.name.toLowerCase());
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { pickSample(i); });
    fileBox.appendChild(b);
    return b;
  });
  function setDots(n) { fileBtns.forEach(function (b, i) { b.setAttribute('aria-pressed', i === n ? 'true' : 'false'); }); }
  function setProfile(sm) {
    var box = $('fhp-ai-prof');
    if (box.getAttribute('data-name') === sm.name) return;
    box.setAttribute('data-name', sm.name);
    box.innerHTML = sm.prof.map(function (p, i) {
      return '<span class="ai-chip' + (p[1] ? ' bad' : '') + '" style="animation-delay:' + (i * 90) + 'ms">' + p[0] + '</span>';
    }).join('');
  }
  function setReady(pct) {
    $('fhp-ai-pct').textContent = Math.round(pct) + '%';
    var arc = $('fhp-ai-arc');
    arc.setAttribute('stroke-dasharray', pct.toFixed(1) + ' 100');
    arc.style.stroke = pct >= 70 ? 'var(--ai-good)' : 'var(--ai-warn)';
  }
  function setLine(li, state, text) {
    li.className = state;
    li.querySelector('.lg-ic').textContent = state === 'ok' ? '✓' : state === 'flag' ? '!' : state === 'run' ? '›' : '·';
    li.querySelector('.lg-r').textContent = text || '';
  }
  function setRec(key, sm) {
    Object.keys(cardEls).forEach(function (k) {
      cardEls[k].classList.toggle('rec', k === key);
      if (k === key && sm) cardEls[k].querySelector('.rec-badge').textContent = 'Best fit for ' + sm.name.toLowerCase();
    });
  }
  function aiShow(sm) {
    aiBox.classList.remove('running');
    $('fhp-ai-status').textContent = 'Analysis complete · ' + sm.name;
    setProfile(sm);
    setDots(SAMPLES.indexOf(sm));
    logLis.forEach(function (li, i) { setLine(li, sm.res[i][0], sm.res[i][1]); });
    setReady(sm.pct);
    $('fhp-ai-lenders').textContent = sm.lenders;
    $('fhp-ai-path').textContent = sm.path;
    setRec(sm.card, sm);
    aiShown = SAMPLES.indexOf(sm);
  }
  function aiFinal() { aiShow(SAMPLES[aiShown]); }
  async function aiOne(sm, tok) {
    aiBox.classList.add('running');
    $('fhp-ai-status').textContent = 'Analyzing ' + sm.name.toLowerCase() + '…';
    setProfile(sm);
    setDots(SAMPLES.indexOf(sm));
    logLis.forEach(function (li) { setLine(li, '', ''); });
    setReady(0);
    $('fhp-ai-lenders').innerHTML = '&mdash;';
    $('fhp-ai-path').innerHTML = '&mdash;';
    await wait(900, tok);
    for (var i = 0; i < logLis.length; i++) {
      setLine(logLis[i], 'run', 'running');
      await wait(i === 5 ? 900 : 520, tok);
      if (i === 5) {
        await tween(0, sm.lenders, 500, function (v) { $('fhp-ai-lenders').textContent = Math.round(v); }, tok);
      }
      setLine(logLis[i], sm.res[i][0], sm.res[i][1]);
    }
    await tween(0, sm.pct, 800, setReady, tok);
    aiShow(sm);
    await wait(3000, tok);
  }
  async function aiRun(tok) {
    if (aiHold) { aiHold = false; await wait(6000, tok); }
    var i = aiIdx;
    aiIdx = (aiIdx + 1) % SAMPLES.length;
    await aiOne(SAMPLES[i], tok);
  }
  $('fhp-ai-go').addEventListener('click', function () {
    var el = cardEls[SAMPLES[aiShown].card];
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  });

  /* ---------- flow strip ---------- */
  var flow = $('fhp-flow');
  var flowLis = flow.querySelectorAll('.st');
  function flowFinal() { flow.classList.add('go'); flowLis.forEach(function (li) { li.classList.add('lit'); }); }
  function flowPlay() {
    flow.classList.remove('go');
    flowLis.forEach(function (li) { li.classList.remove('lit'); });
    void flow.offsetWidth;
    flowLis[0].classList.add('lit');
    flow.classList.add('go');
    setTimeout(function () { flowLis[1].classList.add('lit'); }, 800);
    setTimeout(function () { flowLis[2].classList.add('lit'); }, 1600);
  }

  /* ---------- start everything in its finished state, animate when on screen ---------- */
  var cards = [
    { el: $('fhp-p1'), run: p1Run, fin: p1Final },
    { el: $('fhp-p2'), run: p2Run, fin: p2Final },
    { el: $('fhp-p3'), run: p3Run, fin: p3Final },
    { el: $('fhp-ai'), run: aiRun, fin: aiFinal }
  ];
  cards.forEach(function (c) { c.fin(); });
  flowFinal();

  /* Widget expansion must not move the page (scroll anchoring / late layout). */
  (function installScrollYLock() {
    if (!window.ResizeObserver) return;
    var root = document.getElementById('fhp-root');
    if (!root) return;
    function readY() {
      var b = document.body.scrollTop;
      var d = document.documentElement.scrollTop;
      var w = window.scrollY;
      if (b) return b;
      if (d) return d;
      return w || 0;
    }
    function writeY(y) {
      window.scrollTo(0, y);
      document.documentElement.scrollTop = y;
      document.body.scrollTop = y;
    }
    var savedY = readY();
    var raf = 0;
    function armLock() { savedY = readY(); }
    window.addEventListener('scroll', armLock, { passive: true });
    document.addEventListener('scroll', armLock, { passive: true, capture: true });
    ['wheel', 'touchmove', 'keydown'].forEach(function (ev) {
      window.addEventListener(ev, armLock, { passive: true });
    });
    new ResizeObserver(function () {
      var hold = savedY;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        raf = 0;
        var now = readY();
        if (now === hold) return;
        var delta = now - hold;
        /* Small jumps = scroll anchoring from widget growth; big jumps = user scrolled — re-arm. */
        if (Math.abs(delta) <= 120) writeY(hold);
        else savedY = now;
      });
    }).observe(root);
  })();

  var STOP_MS = 450;
  function cancelStop(c) {
    if (c.stopTimer) { clearTimeout(c.stopTimer); c.stopTimer = null; }
  }
  function startCard(c) {
    cancelStop(c);
    if (c.tok) return;
    var tok = { dead: false };
    c.tok = tok;
    (async function loop() {
      try { while (!tok.dead) { await c.run(tok); } } catch (err) { /* stopped */ }
    })();
  }
  function stopCard(c) {
    cancelStop(c);
    if (!c.tok) return;
    c.tok.dead = true;
    c.tok = null;
    c.fin();
  }
  function scheduleStop(c) {
    cancelStop(c);
    c.stopTimer = setTimeout(function () { stopCard(c); }, STOP_MS);
  }
  var aiCard = cards[3];
  var aiHold = false;
  function pickSample(i) {
    /* instant result on tap, then the loop resumes with the next file after a pause */
    if (aiCard.tok) { aiCard.tok.dead = true; aiCard.tok = null; }
    aiShow(SAMPLES[i]);
    aiIdx = (i + 1) % SAMPLES.length;
    if (reduce) return;
    aiHold = true;
    startCard(aiCard);
  }

  if (reduce || !('IntersectionObserver' in window)) return;

  cards.forEach(function (c) {
    c.tok = null;
    c.ioLive = false;
    var isAi = c === aiCard;
    var target = isAi ? $('fhp-ai') : c.el;
    var startAt = isAi ? 0.22 : 0.35;
    var stopAt = isAi ? 0.1 : 0.12;
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var r = e.intersectionRatio;
        if (e.isIntersecting && r >= startAt) {
          c.ioLive = true;
          startCard(c);
        } else if (!e.isIntersecting || r <= stopAt) {
          if (c.ioLive || c.tok) {
            c.ioLive = false;
            scheduleStop(c);
          }
        }
      });
    }, { threshold: isAi ? [0, 0.1, 0.22, 0.4] : [0, 0.12, 0.35, 0.5], rootMargin: isAi ? '0px' : '0px 0px -8% 0px' }).observe(target);
  });

  var flowSeen = false;
  new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting && !flowSeen) { flowSeen = true; flowPlay(); }
    });
  }, { threshold: 0.6 }).observe(flow);

  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
