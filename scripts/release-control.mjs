// Read-only release decisions, shared by GitHub Actions and the unit suite.
export const REQUIRED_CI_JOBS = Object.freeze([
  ...Array.from({length:6}, (_,i)=>'suite (no database — unit shard '+i+'/6)'),
  ...Array.from({length:6}, (_,i)=>'suite (real Postgres — unit shard '+i+'/6)'),
  'suite (real Postgres — blocks)', 'screens (real browser)'
]);
export const NEW_PR_CUTOVER = '2026-11-03T08:00:00.000Z';

export function checkRequiredJobs(jobs) {
  if(!Array.isArray(jobs)) return {ok:false,reason:'Missing CI job list'};
  const required=new Set(REQUIRED_CI_JOBS), seen=new Set();
  for(const job of jobs) {
    if(!job || !required.has(job.name)) return {ok:false,reason:'Unexpected CI job'};
    if(seen.has(job.name)) return {ok:false,reason:'Duplicate CI job: '+job.name};
    if(job.status!=='completed' || job.conclusion!=='success')
      return {ok:false,reason:'CI job not successful: '+job.name};
    seen.add(job.name);
  }
  return seen.size===required.size
    ? {ok:true,reason:'All 14 exact-head CI jobs passed'}
    : {ok:false,reason:'Only '+seen.size+'/14 required CI jobs passed'};
}

export function releaseDecision({eventName,repo,mainSha,mainMessage,testRun,jobs}) {
  if(!/^[a-f0-9]{40}$/.test(String(mainSha??'')))
    return {status:'fail',reason:'Unable to identify exact main commit'};
  if(String(mainMessage??'').startsWith('ship:'))
    return {status:'skip',reason:'Ship-log-only commit'};
  if(!['workflow_run','workflow_dispatch'].includes(eventName))
    return {status:'fail',reason:'Release requires verified main tests'};
  if(!testRun) return {status:'fail',reason:'No completed main tests for exact commit'};
  if(testRun.head_sha!==mainSha)
    return {status:'skip',reason:'Superseded test SHA; wait for latest main CI'};
  if(testRun.name!=='tests'||testRun.event!=='push'||testRun.head_branch!=='main'||
    testRun.head_repository?.full_name!==repo)
    return {status:'fail',reason:'Receipt was not a same-repo main push'};
  if(testRun.status!=='completed'||testRun.conclusion!=='success')
    return {status:'fail',reason:'Main tests did not complete successfully'};
  const result=checkRequiredJobs(jobs);
  return {status:result.ok?'ship':'fail',reason:result.reason};
}

export function ownerLane(body) {
  const match=/^Owner lane:\s*([a-z][a-z0-9-]{1,40})\s*$/im.exec(String(body??''));
  return match?.[1]?.toLowerCase()??null;
}

export function prOwnershipDecision({current,files,peers,peerFiles,cutover=NEW_PR_CUTOVER}) {
  const isNew=Date.parse(current?.created_at??'')>=Date.parse(cutover);
  const lane=ownerLane(current?.body);
  const fileSet=new Set((files||[]).filter(f=>typeof f==='string'&&f.length));
  const openPeers=(peers||[]).filter(pr=>pr?.state==='open'&&pr.number!==current?.number);
  const ancestors=new Set(), visited=new Set();
  const repo=current?.base?.repo?.full_name;
  let baseRef=current?.base?.ref;
  while(baseRef&&baseRef!=='main'&&!visited.has(baseRef)) {
    visited.add(baseRef);
    const matches=openPeers.filter(pr=>pr.head?.ref===baseRef&&
      (!repo||pr.head?.repo?.full_name===repo));
    if(matches.length!==1)break;
    const parent=matches[0];
    ancestors.add(parent.number);
    baseRef=parent.base?.ref;
  }
  const overlaps=[];
  for(const pr of openPeers) {
    const shared=(peerFiles?.[pr.number]||[]).filter(p=>fileSet.has(p));
    if(!shared.length)continue;
    const isOlder=Date.parse(pr.created_at??'')<Date.parse(current?.created_at??'')||
      (pr.created_at===current?.created_at&&pr.number<current.number);
    overlaps.push({number:pr.number,title:pr.title||'',files:[...new Set(shared)].sort(),isOlder});
  }
  const blockers=isNew?overlaps.filter(x=>x.isOlder&&!ancestors.has(x.number)):[];
  const problems=[];
  if(isNew&&!lane)problems.push('Add Owner lane: <team-name> to PR description');
  if(blockers.length)problems.push('Files are already claimed by older open PRs');
  return {ok:problems.length===0,isNew,lane,overlaps,blockers,problems};
}
