const token = process.env.PURPLE_DOT_ACCESS_TOKEN;

const requestedSkus = [
    ...new Set(
        (process.env.SKUS || "")
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean)
    )
];

if (!token) {
    throw new Error("Missing PURPLE_DOT_ACCESS_TOKEN");
}

if (!requestedSkus.length) {
    throw new Error("No SKUs supplied");
}

const wanted = new Set(requestedSkus);

const BASE_URL =
    "https://www.purpledotprice.com/admin/api/v1/waitlists";

const matches = new Map();

async function getPage(cursor) {

    const url = new URL(BASE_URL);

    url.searchParams.set("limit", "100");

    if (cursor) {
        url.searchParams.set(
            "starting_after",
            cursor
        );
    }

    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            () => controller.abort(),
            30000
        );

    try {

        const response =
            await fetch(url, {
                signal: controller.signal,

                headers: {
                    "X-Purple-Dot-Access-Token":
                        token,

                    "Accept":
                        "application/json"
                }
            });

        const text =
            await response.text();

        if (!response.ok) {

            throw new Error(
                `Purple Dot ${response.status}: ${text}`
            );
        }

        return JSON.parse(text);

    } finally {

        clearTimeout(timeout);
    }
}

let cursor = null;
let page = 0;

while (true) {

    page++;

    console.log(
        `Checking Purple Dot page ${page}...`
    );

    const response =
        await getPage(cursor);

    const data =
        response.data || response;

    const waitlists =
        data.waitlists || [];

    for (const waitlist of waitlists) {

        /*
         * Collect ALL SKU occurrences.
         *
         * A SKU can legitimately belong to
         * more than one waitlist.
         */

        const variants =
            waitlist.availability?.variants || [];

        for (const variant of variants) {

            const sku =
                variant.sku?.trim();

            if (!sku || !wanted.has(sku)) {
                continue;
            }

            if (!matches.has(sku)) {
                matches.set(sku, []);
            }

            /*
             * Deduplicate by actual waitlist ID.
             */

            const existing =
                matches
                    .get(sku)
                    .some(
                        item =>
                            item.waitlist_id ===
                            waitlist.id
                    );

            if (!existing) {

                matches.get(sku).push({

                    sku,

                    waitlist_id:
                        waitlist.id,

                    waitlist
                });
            }
        }
    }

    console.log(
        `Page ${page}: ` +
        `${waitlists.length} waitlists`
    );

    const foundAll =
        requestedSkus.every(
            sku =>
                matches.has(sku)
        );

    /*
     * We can stop once every requested SKU has
     * at least one waitlist.
     *
     * If a SKU has multiple waitlists we keep
     * all of the ones encountered.
     */

    if (foundAll) {
        console.log(
            "All requested SKUs found."
        );

        break;
    }

    const hasMore =
        Boolean(data.has_more);

    if (!hasMore) {
        break;
    }

    cursor =
        data.starting_after || null;

    if (!cursor) {

        throw new Error(
            "Purple Dot reported more pages " +
            "but did not provide a cursor."
        );
    }
}


/*
 * Build result.
 */

const results = [];
const matched = [];

for (const sku of requestedSkus) {

    const found =
        matches.get(sku) || [];

    if (!found.length) {

        results.push({
            sku,
            status: "NOT_FOUND",
            waitlists: []
        });

        continue;
    }

    const waitlists =
        found.map(item => {

            const waitlist =
                item.waitlist;

            return {

                sku,

                waitlist_id:
                    item.waitlist_id,

                earliest_ship_date:
                    waitlist.earliest_ship_date ||
                    null,

                latest_ship_date:
                    waitlist.latest_ship_date ||
                    null,

                state:
                    waitlist.state ||
                    null,

                title:
                    waitlist.availability?.product?.title ||
                    null
            };
        });

    results.push({

        sku,

        status: "MATCHED",

        waitlist_count:
            waitlists.length,

        waitlists
    });

    for (const waitlist of waitlists) {

        matched.push(waitlist);
    }
}


const output = {

    requested_count:
        requestedSkus.length,

    matched_count:
        matched.length,

    not_found_count:
        results.filter(
            x =>
                x.status === "NOT_FOUND"
        ).length,

    results,

    matched
};


console.log("");
console.log(
    "========== LOOKUP COMPLETE =========="
);

console.log(
    `Requested SKUs: ${requestedSkus.length}`
);

console.log(
    `Waitlists found: ${matched.length}`
);

console.log(
    `SKUs not found: ${output.not_found_count}`
);

console.log(
    "======================================"
);


/*
 * IMPORTANT:
 *
 * The frontend reads RESULT_JSON from the logs.
 */

console.log(
    "RESULT_JSON=" +
    JSON.stringify(output)
);


const fs =
    await import("node:fs");

fs.writeFileSync(
    "lookup-result.json",
    JSON.stringify(
        output,
        null,
        2
    )
);
