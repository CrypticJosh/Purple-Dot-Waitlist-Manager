const $=id=>document.getElementById(id);
let requested=[];
let lookup=null;
let runId=null;
let pollTimer=null;

function skus(){return [...new Set($("skus").value.split(/[\n,\t,;]+/).map(x=>x.trim()).filter(Boolean))]}
function fmtDate(v){if(!v)return "—";const d=new Date(v);if(Number.isNaN(d.getTime()))return v;return d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}
function status(msg,cls=""){$("status").className="status "+cls;$("status").textContent=msg}
function dateValid(){return $("earliest").value&&$("latest").value&&$("latest").value>=$("earliest").value}
function payload(){return JSON.stringify({skus:requested,earliest_ship_date:$("earliest").value,latest_ship_date:$("latest").value})}

$("skus").addEventListener("input",()=>{$("skuCount").textContent=`${skus().length} SKU${skus().length===1?"":"s"}`});
$("earliest").addEventListener("change",()=>{$("earliestPreview").textContent=fmtDate($("earliest").value);$("update").disabled=!dateValid()||!lookup?.matched?.length});
$("latest").addEventListener("change",()=>{$("latestPreview").textContent=fmtDate($("latest").value);$("update").disabled=!dateValid()||!lookup?.matched?.length});

async function gh(path,opts={}){
  const owner=$("repoOwner").value.trim(),repo=$("repoName").value.trim(),token=$("githubToken").value.trim();
  if(!owner||!repo||!token)throw new Error("Enter your GitHub owner, repository and token first.");
  const r=await fetch("https://api.github.com/repos/"+encodeURIComponent(owner)+"/"+encodeURIComponent(repo)+path,{...opts,headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+token,"X-GitHub-Api-Version":"2026-03-10",...(opts.headers||{})}});
  if(!r.ok)throw new Error(`GitHub ${r.status}: ${await r.text()}`);
  return r.status===204?null:r.json();
}

$("find").addEventListener("click",async()=>{
  requested=skus();
  if(!requested.length){status("Enter at least one SKU.","bad");return}
  $("reviewCard").classList.remove("hidden");$("datesCard").classList.add("hidden");
  $("lookupState").className="loading";$("lookupState").innerHTML='<span class="spinner"></span> Finding waitlists…';
  $("reviewTable").innerHTML="";
  try{
    const branch=$("branch").value.trim()||"main";
    const data=await gh("/actions/workflows/purple-dot-lookup.yml/dispatches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ref:branch,inputs:{skus:requested.join("\n")}})});
    // Dispatch is normally 204. Find the newest run after a short delay.
    await waitForRun();
  }catch(e){$("lookupState").textContent=e.message;status(e.message,"bad")}
});

async function waitForRun(){
  let tries=0;
  const tick=async()=>{
    tries++;
    const branch=$("branch").value.trim()||"main";
    const data=await gh(`/actions/runs?event=workflow_dispatch&branch=${encodeURIComponent(branch)}&per_page=10`);
    const runs=data.workflow_runs||[];
    const candidate=runs.find(r=>r.name==="Purple Dot Waitlist Lookup"&&(r.status==="queued"||r.status==="in_progress"||r.status==="completed"));
    if(!candidate){if(tries<30)return pollTimer=setTimeout(tick,1500);throw new Error("Could not find the lookup workflow run.");}
    runId=candidate.id;
    if(candidate.status!=="completed"){ $("lookupState").innerHTML=`<span class="spinner"></span> Purple Dot lookup running…`; return pollTimer=setTimeout(tick,1500);}
    await readArtifact();
  };
  tick();
}

async function readArtifact(){
  const data=await gh(`/actions/runs/${runId}/artifacts`);
  const art=(data.artifacts||[]).find(a=>a.name==="purple-dot-lookup-result");
  if(!art)throw new Error("Lookup finished but no result artifact was found.");
  const blob=await fetch(art.archive_download_url,{headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+$("githubToken").value.trim(),"X-GitHub-Api-Version":"2026-03-10"}}).then(r=>{if(!r.ok)throw new Error("Could not download the lookup result.");return r.blob()});
  const zip=await blob.arrayBuffer();
  const bytes=new Uint8Array(zip);
  // Browser-side ZIP parsing without a library is intentionally avoided. The workflow also writes results to the run summary.
  // Instead, ask GitHub for the job logs, which include a compact RESULT_JSON line.
  const jobs=await gh(`/actions/runs/${runId}/jobs?per_page=20`);
  const job=(jobs.jobs||[])[0];
  if(!job)throw new Error("Lookup job not found.");
  const logRes=await fetch(`https://api.github.com/repos/${encodeURIComponent($("repoOwner").value.trim())}/${encodeURIComponent($("repoName").value.trim())}/actions/jobs/${job.id}/logs`,{headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+$("githubToken").value.trim(),"X-GitHub-Api-Version":"2026-03-10"}});
  const text=await logRes.text();
  const marker="RESULT_JSON=";
  const pos=text.lastIndexOf(marker);
  if(pos<0)throw new Error("Lookup completed but its result could not be read.");
  const line=text.slice(pos+marker.length).split("\n")[0].trim();
  lookup=JSON.parse(line);
  renderLookup();
}

function renderLookup(){
  const rows=lookup.results||[];
  $("lookupState").textContent=`${lookup.matched_count} matched · ${lookup.not_found_count} not found · ${lookup.ambiguous_count} ambiguous`;
  let html=`<div class="table-wrap"><table><thead><tr><th>SKU</th><th>Current earliest</th><th>Current latest</th><th>State</th><th>Result</th></tr></thead><tbody>`;
  for(const r of rows){
    const cls=r.status==="MATCHED"?"":r.status==="NOT_FOUND"?"bad":"warn";
    html+=`<tr><td class="sku">${esc(r.sku)}</td><td class="date-old">${fmtDate(r.earliest_ship_date)}</td><td class="date-old">${fmtDate(r.latest_ship_date)}</td><td>${r.state?`<span class="state">${esc(r.state)}</span>`:"—"}</td><td><span class="state ${cls}">${r.status==="MATCHED"?"Ready":r.status==="NOT_FOUND"?"Not found":"Ambiguous"}</span></td></tr>`;
  }
  html+="</tbody></table></div>";
  $("reviewTable").innerHTML=html;
  $("datesCard").classList.remove("hidden");
  $("update").disabled=!dateValid()||lookup.matched_count===0;
}

$("update").addEventListener("click",async()=>{
  if(!dateValid()||!lookup?.matched?.length)return;
  if(!confirm(`Update ${lookup.matched.length} matched waitlists?\n\n${fmtDate($("earliest").value)} → ${fmtDate($("latest").value)}`))return;
  $("update").disabled=true;status("Starting the Purple Dot update…");
  try{
    const branch=$("branch").value.trim()||"main";
    await gh("/actions/workflows/purple-dot-update.yml/dispatches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ref:branch,inputs:{payload:payload()}})});
    status("Update workflow started.\n\nPurple Dot is now being updated. You can open the Actions tab to see the run.","ok");
  }catch(e){status(e.message,"bad");$("update").disabled=false}
});
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
