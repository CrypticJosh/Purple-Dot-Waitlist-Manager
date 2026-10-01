const token=process.env.PURPLE_DOT_ACCESS_TOKEN;
const skus=[...new Set((process.env.SKUS||"").split(/\n/).map(s=>s.trim()).filter(Boolean))];
if(!token)throw new Error("Missing PURPLE_DOT_ACCESS_TOKEN");
const base="https://www.purpledotprice.com/admin/api/v1/waitlists";
async function page(cursor){
  const u=new URL(base);u.searchParams.set("limit","100");if(cursor)u.searchParams.set("starting_after",cursor);
  const r=await fetch(u,{headers:{"X-Purple-Dot-Access-Token":token,"Accept":"application/json"}});
  const t=await r.text();if(!r.ok)throw new Error(`Purple Dot GET ${r.status}: ${t}`);return JSON.parse(t);
}
const all=[];let cursor=null;
do{const x=await page(cursor);const d=x.data||x;all.push(...(d.waitlists||[]));cursor=d.has_more?d.starting_after:null}while(cursor);
const map=new Map();
for(const w of all)for(const v of w.availability?.variants||[]){if(!v.sku)continue;if(!map.has(v.sku))map.set(v.sku,[]);map.get(v.sku).push({w,v})}
const results=[],matched=[];
for(const sku of skus){
  const m=map.get(sku)||[];
  if(m.length===0){results.push({sku,status:"NOT_FOUND"});continue}
  if(m.length>1){results.push({sku,status:"AMBIGUOUS",waitlist_ids:m.map(x=>x.w.id)});continue}
  const {w}=m[0];
  matched.push({sku,waitlist_id:w.id,product_id:w.availability.product.product_id});
  results.push({sku,status:"MATCHED",waitlist_id:w.id,earliest_ship_date:w.earliest_ship_date,latest_ship_date:w.latest_ship_date,state:w.state,product_id:w.availability.product.product_id});
}
const out={matched_count:matched.length,not_found_count:results.filter(x=>x.status==="NOT_FOUND").length,ambiguous_count:results.filter(x=>x.status==="AMBIGUOUS").length,matched,results};
console.log("RESULT_JSON="+JSON.stringify(out));
await import("node:fs").then(fs=>fs.writeFileSync("lookup-result.json",JSON.stringify(out,null,2)));
