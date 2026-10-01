const payload=JSON.parse(process.env.PAYLOAD||"{}"),token=process.env.PURPLE_DOT_ACCESS_TOKEN;
if(!token)throw new Error("Missing PURPLE_DOT_ACCESS_TOKEN");
const skus=[...new Set((payload.skus||[]).map(String).map(s=>s.trim()).filter(Boolean))],earliest=payload.earliest_ship_date,latest=payload.latest_ship_date;
if(!skus.length||!earliest||!latest)throw new Error("SKUs and both dates are required.");
if(latest<earliest)throw new Error("Latest date cannot be before earliest date.");
const base="https://www.purpledotprice.com/admin/api/v1/waitlists";
async function page(cursor){const u=new URL(base);u.searchParams.set("limit","100");if(cursor)u.searchParams.set("starting_after",cursor);const r=await fetch(u,{headers:{"X-Purple-Dot-Access-Token":token,"Accept":"application/json"}});const t=await r.text();if(!r.ok)throw new Error(`GET ${r.status}: ${t}`);return JSON.parse(t)}
const all=[];let cursor=null;do{const x=await page(cursor),d=x.data||x;all.push(...(d.waitlists||[]));cursor=d.has_more?d.starting_after:null}while(cursor);
const map=new Map();for(const w of all)for(const v of w.availability?.variants||[]){if(v.sku){if(!map.has(v.sku))map.set(v.sku,[]);map.get(v.sku).push({w,v})}}
const results=[];
for(const sku of skus){
 const m=map.get(sku)||[];
 if(m.length!==1){results.push({sku,status:m.length?"AMBIGUOUS":"NOT_FOUND"});continue}
 const w=m[0].w;
 // Purple Dot documents the update body as product_id, dates, max_units, state and labels.
 // Preserve the existing allocations and labels. Normalize legacy LIVE/SCHEDULED values to accepted write states.
 const state=w.state==="LIVE"?"OPEN":w.state==="SCHEDULED"?"OPEN":w.state;
 const max_units=(w.availability?.variants||[]).map(v=>({sku_id:String(v.variant_id),max_units:Number.isFinite(v.buy_size)?v.buy_size:0}));
 const body={product_id:String(w.availability.product.product_id),earliest_ship_date:earliest,latest_ship_date:latest,max_units,state,labels:w.labels||[]};
 const r=await fetch(`${base}/${encodeURIComponent(w.id)}`,{method:"PUT",headers:{"X-Purple-Dot-Access-Token":token,"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(body)});
 const t=await r.text();
 results.push(r.ok?{sku,status:"UPDATED",waitlist_id:w.id}:{sku,status:"FAILED",waitlist_id:w.id,http_status:r.status,response:t.slice(0,800)});
}
console.log(JSON.stringify({requested:skus.length,updated:results.filter(x=>x.status==="UPDATED").length,failed:results.filter(x=>x.status==="FAILED").length,results},null,2));
