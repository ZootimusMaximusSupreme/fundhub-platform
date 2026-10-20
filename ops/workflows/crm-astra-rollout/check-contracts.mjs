import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,"../../..");
const BASE="f1ab024ee0fca5b236ecac50957ec0286c628101";
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,"ops/workflows/crm-portal-layout-manifest.json"),"utf8"));
const pages=[...manifest.pages.map(page=>page.page),"public/app/closer-call.html"];
const scripts=html=>Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi),match=>({attributes:match[1].trim(),body:match[2]}));
const ids=html=>Array.from(html.matchAll(/\bid=["']([^"']+)["']/g),match=>match[1]);
const hash=text=>crypto.createHash("sha256").update(text).digest("hex");
// Root reviewed the complete diff: only the map's label fonts, contrast,
// text wrapping and narrow-canvas cluster spacing change. Fixed hash pairs
// prevent this exception from hiding any later action/data/endpoint edit.
const reviewedCanvas={before:"384a5e779407d1c362e09c2f4ec527933f9a921fe32362cba5da1fc3ab74cfc6",after:"97cd4eb3511633cb0641c30377870019b806f77af374e3b0f8591990aa00bc13"};
const hook="FHData.staff({ limit: 200 }).then(function (result) {\n    if (window.AstraTeamUI) window.AstraTeamUI.setReadResult(result);\n    return result;\n  })";
const results=[];
for(const file of pages){
 const before=execFileSync("git",["show",`${BASE}:${file}`],{cwd:ROOT,encoding:"utf8"});
 const after=fs.readFileSync(path.join(ROOT,file),"utf8");
 const issues=[];
 const a=scripts(before),b=scripts(after);
 const originalBodies=a.map(script=>script.body);
 const currentBodies=b.map(script=>file.endsWith("staff-teams.html")?script.body.replace(hook,"FHData.staff({ limit: 200 })"):script.body);
 for(let index=0;index<a.length;index++){
   const visualCanvas=file==="public/app/partner-galaxy.html"&&index===3&&hash(originalBodies[index])===reviewedCanvas.before&&hash(currentBodies[index]||"")===reviewedCanvas.after;
   if(a[index].attributes!==b[index]?.attributes||(originalBodies[index]!==currentBodies[index]&&!visualCanvas))issues.push(`Original script ${index+1} changed`);
 }
 if(b.length!==a.length+(file.endsWith("staff-teams.html")?1:0))issues.push("Unexpected script-count change");
 const beforeIDs=ids(before),afterIDs=ids(after);
 for(const id of new Set(beforeIDs))if(!afterIDs.includes(id))issues.push(`Original ID removed: ${id}`);
 const optedIn=/<body\b[^>]*class=["'][^"']*\bfh-astra\b/.test(after);
 const sharedStyle=/href=["']\/app\/fundhub-astra\.css["']/.test(after);
 // Final cascade is part of the rollout contract, not just the presence of a
 // stylesheet. Ignore HTML-looking strings inside original script bodies.
 const markup=after.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"");
 const styles=Array.from(markup.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>|<link\b[^>]*>/gi))
   .filter(match=>/^<style\b/i.test(match[0])||/\brel=["']stylesheet["']/i.test(match[0]));
 const isAstra=tag=>/\bhref=["'][^"']*\/fundhub-astra(?:-staff|-client)?\.css["']/i.test(tag);
 const firstAstra=styles.findIndex(match=>isAstra(match[0]));
 const finalCascade=!optedIn||(firstAstra>=0&&styles.slice(firstAstra).every(match=>isAstra(match[0])));
 if(optedIn&&!sharedStyle)issues.push("Astra opt-in is missing its shared stylesheet");
 if(!finalCascade)issues.push("Astra styles load before later legacy styles");
 results.push({file,changed:before!==after,optedIn,sharedStyle,finalCascade,originalScripts:a.length,currentScripts:b.length,baselineHash:hash(before),currentHash:hash(after),issues});
}
const report={checkedAt:new Date().toISOString(),base:BASE,total:results.length,changed:results.filter(page=>page.changed).length,optedIn:results.filter(page=>page.optedIn).length,unchanged:results.filter(page=>!page.changed).map(page=>page.file),contractIssues:results.filter(page=>page.issues.length),results};
fs.writeFileSync(path.join(HERE,"source-contracts.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({...report,results:undefined},null,2));
if(report.contractIssues.length)process.exitCode=1;
