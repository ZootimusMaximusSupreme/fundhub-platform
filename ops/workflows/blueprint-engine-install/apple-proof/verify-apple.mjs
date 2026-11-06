import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
import {makeAppleClient,readReceipt} from '../../../../scripts/ios-release-handoff.mjs';
const root=process.cwd(),out=path.join(root,'ops/workflows/blueprint-engine-install/apple-proof');
const env=parseEnv(fs.readFileSync('/Users/chrisstanbridge/Developer/fundhub-platform/.env','utf8'));
const request=async(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(20000)});
const base=makeAppleClient(env,request);
const apple=async(method,url,body)=>{if(method!=='GET')throw new Error('Read-only Apple verifier refuses writes');return base(method,url,body);};
async function list(endpoint){const rows=[];let next=endpoint;for(let n=0;next&&n<10;n++){const r=await apple('GET',next);rows.push(...r.data);next=r.links?.next||null;}if(next)throw new Error('Pagination not completed');return rows;}
const result={checkedAt:new Date().toISOString(),appId:'6823985032',appleWrites:0,credentialsChanged:false,failures:[]};
try{
 const [receipt,versions,builds,publicLookup]=await Promise.all([readReceipt(apple,{version:'1.0.3',build:'9'}),list('/v1/apps/6823985032/appStoreVersions?limit=50'),list('/v1/apps/6823985032/builds?limit=200'),request('https://itunes.apple.com/lookup?id=6823985032&country=us').then(r=>r.json())]);
 const a=receipt.appVersion,b=receipt.uploaded,s=receipt.submission;
 result.exactReceipt={versionId:a.id,version:a.attributes.versionString,state:a.attributes.appStoreState,releaseType:a.attributes.releaseType,buildId:b.id,build:b.attributes.version,processingState:b.attributes.processingState,expired:b.attributes.expired,uploadedDate:b.attributes.uploadedDate,expirationDate:b.attributes.expirationDate,attachedBuildId:receipt.attached?.id,reviewSubmissionId:s?.id,reviewState:s?.attributes.state,submittedDate:s?.attributes.submittedDate};
 result.appStoreVersions=versions.map(v=>({id:v.id,version:v.attributes.versionString,platform:v.attributes.platform,state:v.attributes.appStoreState,releaseType:v.attributes.releaseType}));
 result.uploadedBuilds=builds.map(v=>({id:v.id,build:v.attributes.version,processingState:v.attributes.processingState,expired:v.attributes.expired,uploadedDate:v.attributes.uploadedDate})).sort((a,b)=>String(b.uploadedDate).localeCompare(String(a.uploadedDate)));
 const p=publicLookup.results?.find(v=>String(v.trackId)==='6823985032');result.publicStore=p?{version:p.version,releaseDate:p.currentVersionReleaseDate,bundleId:p.bundleId,url:p.trackViewUrl,minimumOsVersion:p.minimumOsVersion}:null;
 for(const [key,rel] of [['betaDetail','buildBetaDetail'],['betaGroups','betaGroups'],['betaReview','betaAppReviewSubmission']]){
  const endpoint=b.relationships?.[rel]?.links?.related;
  if(!endpoint){result[key]={available:false};continue;}
  try{const r=await apple('GET',endpoint);if(key==='betaGroups'){result[key]={count:r.data?.length||0,groups:(r.data||[]).map(g=>({id:g.id,isInternalGroup:g.attributes?.isInternalGroup,hasAccessToAllBuilds:g.attributes?.hasAccessToAllBuilds,publicLinkEnabled:g.attributes?.publicLinkEnabled}))};}
   else result[key]=r.data?{id:r.data.id,...r.data.attributes}:{available:false};
  }catch(e){result[key]={error:e.message};}
 }
 const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
 result.nativeSource={head:git('rev-parse','HEAD'),latestNativeCommit:git('log','-1','--format=%H','--','tools/fundhub-ios'),headTree:git('rev-parse','HEAD:tools/fundhub-ios'),releaseTree:git('rev-parse','be7963cab076b6f1fd329eaaa694438948477233:tools/fundhub-ios')};
 result.nativeSource.unchangedSincePublicReleaseSource=result.nativeSource.headTree===result.nativeSource.releaseTree;
 const releaseHome='/Users/chrisstanbridge/Library/Application Support/Fundhub/iOS Releases';
 for(const file of ['watchdog-status.json','auto-start.json']){try{const v=JSON.parse(fs.readFileSync(path.join(releaseHome,file),'utf8'));result[file]={...Object.fromEntries(['checkedAt','status','pending','busy','failed','blockedReason','sha','version','build','seededAt','lastTickAt'].filter(k=>k in v).map(k=>[k,v[k]]))};}catch(e){result[file]={available:false};}}
 fs.writeFileSync(path.join(out,'apple-receipt.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({checkedAt:result.checkedAt,exactReceipt:result.exactReceipt,publicStore:result.publicStore,betaDetail:result.betaDetail,betaGroups:result.betaGroups,betaReview:result.betaReview,nativeSource:result.nativeSource},null,2));
}catch(e){result.failures.push({message:e.message});fs.writeFileSync(path.join(out,'apple-receipt.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({error:e.message}));process.exitCode=1;}
