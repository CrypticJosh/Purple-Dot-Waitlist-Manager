const token = process.env.PURPLE_DOT_ACCESS_TOKEN;
const requestedSkus = [...new Set(
  (process.env.SKUS || "")
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
)];

if (!token) {
  throw new Error("Missing PURPLE_DOT_ACCESS_TOKEN");
}

if (!requestedSkus.length) {
  throw new Error("No SKUs supplied");
}

const base =
  "https://www.purpledotprice.com/admin/api/v1/waitlists";

const wanted = new Set(requestedSkus);
const matches = new Map();

async function getPage(cursor) {
  const url = new URL(base);

  url.searchParams.set("limit", "100");

  if (cursor) {
    url.searchParams.set("starting_after", cursor);
  }

  console.log(
    `Searching Purple Dot${cursor ? ` after ${cursor}` : ""}...`
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "X-Purple-Dot-Access-Token": token,
        "Accept": "application/json"
      }
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Purple Dot returned ${response.status}: ${text}`
      );
    }

    return JSON.parse(text);

  } finally {
    clearTimeout(timeout);
  }
}

let cursor = null;
let page = 0;
let hasMore = true;

while (hasMore) {
  page++;

  console.log(`Checking page ${page}...`);

  const response = await getPage(cursor);
  const data = response.data || response;

  const waitlists = data.waitlists || [];

  for (const waitlist of waitlists) {

    const variants =
      waitlist.availability?.variants || [];

    for (const variant of variants) {

      if (!variant.sku) continue;

      if (!wanted.has(variant.sku)) continue;

      if (!matches.has(variant.sku)) {
        matches.set(variant.sku, []);
      }

      matches.get(variant.sku).push({
        waitlist: waitlist,
        variant: variant
      });
    }
  }

  console.log(
    `Page ${page}: ${waitlists.length} waitlists. ` +
    `${matches.size}/${wanted.size} requested SKUs found.`
  );

  /*
   * Important optimisation:
   * Once every requested SKU has been found,
   * there is no reason to download the remaining
   * Purple Dot waitlists.
   */

  if (matches.size >= wanted.size) {
    console.log("All requested SKUs found.");
    break;
  }

  hasMore = Boolean(data.has_more);

  cursor = data.starting_after || null;

  if (hasMore && !cursor) {
    throw new Error(
      "Purple Dot reported more pages but did not provide a cursor."
    );
  }
}

const results = [];
const matched = [];

for (const sku of requestedSkus) {

  const found = matches.get(sku) || [];

  if (found.length === 0) {

    results.push({
      sku,
      status: "NOT_FOUND"
    });

    continue;
  }

  if (found.length > 1) {

    results.push({
      sku,
      status: "AMBIGUOUS",
      waitlist_ids: found.map(x => x.waitlist.id)
    });

    continue;
  }

  const { waitlist } = found[0];

  const result = {
    sku,
    status: "MATCHED",
    waitlist_id: waitlist.id,
    product_id:
      waitlist.availability?.product?.product_id || null,
    earliest_ship_date:
      waitlist.earliest_ship_date || null,
    latest_ship_date:
      waitlist.latest_ship_date || null,
    state:
      waitlist.state || null
  };

  matched.push({
    sku,
    waitlist_id: waitlist.id,
    product_id:
      waitlist.availability?.product?.product_id || null
  });

  results.push(result);
}

const output = {
  requested_count: requestedSkus.length,
  matched_count: matched.length,

  not_found_count:
    results.filter(x => x.status === "NOT_FOUND").length,

  ambiguous_count:
    results.filter(x => x.status === "AMBIGUOUS").length,

  matched,

  results
};

console.log("");
console.log("========== LOOKUP COMPLETE ==========");
console.log(`Requested: ${requestedSkus.length}`);
console.log(`Matched: ${output.matched_count}`);
console.log(`Not found: ${output.not_found_count}`);
console.log(`Ambiguous: ${output.ambiguous_count}`);
console.log("======================================");

console.log(
  "RESULT_JSON=" +
  JSON.stringify(output)
);

const fs = await import("node:fs");

fs.writeFileSync(
  "lookup-result.json",
  JSON.stringify(output, null, 2)
);
