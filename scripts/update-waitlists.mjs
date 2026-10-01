const token =
    process.env.PURPLE_DOT_ACCESS_TOKEN;

const payload =
    JSON.parse(
        process.env.PAYLOAD || "{}"
    );


if (!token) {
    throw new Error(
        "Missing PURPLE_DOT_ACCESS_TOKEN"
    );
}


const waitlists =
    payload.waitlists || [];


if (!waitlists.length) {
    throw new Error(
        "No waitlists were selected."
    );
}


const earliest =
    payload.earliest_ship_date;


const latest =
    payload.latest_ship_date;


const reason =
    payload.reason || "";


const includeReasonInEmail =
    Boolean(
        payload.include_reason_in_email
    );


if (!earliest || !latest) {
    throw new Error(
        "Missing new ship dates."
    );
}


if (!reason) {
    throw new Error(
        "Missing reason for change."
    );
}


console.log(
    "======================================"
);

console.log(
    "PURPLE DOT BULK UPDATE"
);

console.log(
    `Waitlists: ${waitlists.length}`
);

console.log(
    `Earliest: ${earliest}`
);

console.log(
    `Latest: ${latest}`
);

console.log(
    `Reason: ${reason}`
);

console.log(
    `Include reason in email: ${includeReasonInEmail}`
);

console.log(
    "======================================"
);


/*
 * IMPORTANT
 *
 * This is where the exact Purple Dot update
 * request needs to be made.
 *
 * We deliberately don't guess the API fields
 * for the reason/customer-email options.
 *
 * For now we print the selected records so
 * the workflow can be tested safely.
 */


for (
    const waitlist of waitlists
) {

    console.log(
        JSON.stringify(
            {
                waitlist_id:
                    waitlist.waitlist_id,

                sku:
                    waitlist.sku,

                earliest_ship_date:
                    earliest,

                latest_ship_date:
                    latest,

                reason,

                include_reason_in_email:
                    includeReasonInEmail
            }
        )
    );
}


console.log(
    "UPDATE_REQUEST_READY"
);
