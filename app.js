const $ = id =>
    document.getElementById(id);

let requested = [];
let lookup = null;
let runId = null;


/* -----------------------------
   Helpers
----------------------------- */

function getSkus() {

    return [
        ...new Set(
            $("skus")
                .value
                .split(/[\n,\t,;]+/)
                .map(x => x.trim())
                .filter(Boolean)
        )
    ];
}


function escapeHtml(value) {

    return String(value ?? "")
        .replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        }[char]));
}


function formatDate(value) {

    if (!value) {
        return "—";
    }

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return value;
    }

    return date.toLocaleDateString(
        "en-GB",
        {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }
    );
}


function setStatus(
    message,
    type = ""
) {

    const element =
        $("status");

    if (!element) {
        return;
    }

    element.className =
        `status ${type}`;

    element.textContent =
        message;
}


/* -----------------------------
   Dates
----------------------------- */

function datesValid() {

    const earliest =
        $("earliest").value;

    const latest =
        $("latest").value;

    return Boolean(
        earliest &&
        latest &&
        latest >= earliest
    );
}


function updateDatePreview() {

    $("earliestPreview")
        .textContent =
        formatDate(
            $("earliest").value
        );

    $("latestPreview")
        .textContent =
        formatDate(
            $("latest").value
        );

    updateButtonState();
}


/* -----------------------------
   Selection
----------------------------- */

function getSelectedWaitlists() {

    return [
        ...document.querySelectorAll(
            ".waitlist-check:checked"
        )
    ].map(
        checkbox =>
            JSON.parse(
                checkbox.dataset.waitlist
            )
    );
}


function updateSelectionCount() {

    const selected =
        getSelectedWaitlists();

    $("selectionCount")
        .textContent =
        `${selected.length} selected`;

    updateButtonState();
}


function updateButtonState() {

    const button =
        $("update");

    if (!button) {
        return;
    }

    button.disabled =
        !datesValid() ||
        getSelectedWaitlists().length === 0;
}


function selectAll() {

    document
        .querySelectorAll(
            ".waitlist-check"
        )
        .forEach(
            checkbox =>
                checkbox.checked = true
        );

    updateSelectionCount();
}


function clearAll() {

    document
        .querySelectorAll(
            ".waitlist-check"
        )
        .forEach(
            checkbox =>
                checkbox.checked = false
        );

    updateSelectionCount();
}


/* -----------------------------
   GitHub
----------------------------- */

async function githubRequest(
    path,
    options = {}
) {

    const owner =
        $("repoOwner")
            .value
            .trim();

    const repo =
        $("repoName")
            .value
            .trim();

    const token =
        $("githubToken")
            .value
            .trim();

    if (!owner) {
        throw new Error(
            "Enter your GitHub owner."
        );
    }

    if (!repo) {
        throw new Error(
            "Enter your GitHub repository."
        );
    }

    if (!token) {
        throw new Error(
            "Enter your GitHub fine-grained token."
        );
    }

    const response =
        await fetch(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`,
            {
                ...options,

                headers: {
                    "Accept":
                        "application/vnd.github+json",

                    "Authorization":
                        `Bearer ${token}`,

                    "X-GitHub-Api-Version":
                        "2022-11-28",

                    ...(options.headers || {})
                }
            }
        );

    const text =
        await response.text();

    if (!response.ok) {

        let message =
            text;

        try {

            const json =
                JSON.parse(text);

            if (json.message) {
                message =
                    json.message;
            }

        } catch {}

        throw new Error(
            `GitHub ${response.status}: ${message}`
        );
    }

    if (!text) {
        return null;
    }

    return JSON.parse(text);
}


/* -----------------------------
   Find Waitlists
----------------------------- */

$("find")
    .addEventListener(
        "click",
        async () => {

            requested =
                getSkus();

            if (!requested.length) {

                setStatus(
                    "Enter at least one SKU.",
                    "bad"
                );

                return;
            }

            $("reviewCard")
                .classList
                .remove("hidden");

            $("datesCard")
                .classList
                .add("hidden");

            $("lookupState")
                .innerHTML =
                '<span class="spinner"></span> Starting Purple Dot lookup…';

            $("reviewTable")
                .innerHTML = "";

            try {

                const branch =
                    $("branch")
                        .value
                        .trim() ||
                    "main";

                await githubRequest(
                    "/actions/workflows/purple-dot-lookup.yml"
                );

                await githubRequest(
                    "/actions/workflows/purple-dot-lookup.yml/dispatches",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                ref: branch,

                                inputs: {
                                    skus:
                                        requested.join(
                                            "\n"
                                        )
                                }
                            })
                    }
                );

                $("lookupState")
                    .innerHTML =
                    '<span class="spinner"></span> Purple Dot lookup started…';

                setTimeout(
                    findLatestLookupRun,
                    2500
                );

            } catch (error) {

                $("lookupState")
                    .textContent =
                    error.message;

                setStatus(
                    error.message,
                    "bad"
                );
            }
        }
    );


/* -----------------------------
   Find latest run
----------------------------- */

async function findLatestLookupRun() {

    try {

        const branch =
            $("branch")
                .value
                .trim() ||
            "main";

        const data =
            await githubRequest(
                `/actions/runs?event=workflow_dispatch&branch=${encodeURIComponent(branch)}&per_page=20`
            );

        const runs =
            data.workflow_runs || [];

        const lookupRuns =
            runs.filter(
                run =>
                    run.path ===
                    ".github/workflows/purple-dot-lookup.yml"
            );

        if (!lookupRuns.length) {

            $("lookupState")
                .innerHTML =
                '<span class="spinner"></span> Waiting for GitHub…';

            setTimeout(
                findLatestLookupRun,
                2000
            );

            return;
        }

        const run =
            lookupRuns[0];

        runId =
            run.id;

        if (
            run.status ===
                "queued" ||
            run.status ===
                "in_progress"
        ) {

            $("lookupState")
                .innerHTML =
                '<span class="spinner"></span> Purple Dot lookup running…';

            setTimeout(
                findLatestLookupRun,
                2000
            );

            return;
        }

        if (
            run.status ===
            "completed"
        ) {

            if (
                run.conclusion !==
                "success"
            ) {

                throw new Error(
                    `Lookup failed: ${run.conclusion}`
                );
            }

            await readLookupResult();
        }

    } catch (error) {

        $("lookupState")
            .textContent =
            error.message;

        setStatus(
            error.message,
            "bad"
        );
    }
}


/* -----------------------------
   Read result
----------------------------- */

async function readLookupResult() {

    try {

        $("lookupState")
            .innerHTML =
            '<span class="spinner"></span> Loading results…';

        const jobs =
            await githubRequest(
                `/actions/runs/${runId}/jobs?per_page=20`
            );

        const job =
            (jobs.jobs || [])[0];

        if (!job) {

            throw new Error(
                "Lookup job not found."
            );
        }

        const owner =
            $("repoOwner")
                .value
                .trim();

        const repo =
            $("repoName")
                .value
                .trim();

        const token =
            $("githubToken")
                .value
                .trim();

        const response =
            await fetch(
                `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/jobs/${job.id}/logs`,
                {
                    headers: {
                        "Accept":
                            "application/vnd.github+json",

                        "Authorization":
                            `Bearer ${token}`,

                        "X-GitHub-Api-Version":
                            "2022-11-28"
                    }
                }
            );

        if (!response.ok) {

            throw new Error(
                `Could not read lookup logs (${response.status}).`
            );
        }

        const logs =
            await response.text();

        const marker =
            "RESULT_JSON=";

        const position =
            logs.lastIndexOf(
                marker
            );

        if (
            position === -1
        ) {

            throw new Error(
                "Lookup completed but no result was found."
            );
        }

        const jsonText =
            logs
                .slice(
                    position +
                    marker.length
                )
                .split(/\r?\n/)[0]
                .trim();

        lookup =
            JSON.parse(
                jsonText
            );

        renderLookup();

    } catch (error) {

        $("lookupState")
            .textContent =
            error.message;

        setStatus(
            error.message,
            "bad"
        );
    }
}


/* -----------------------------
   Render waitlists
----------------------------- */

function renderLookup() {

    const results =
        lookup.results || [];

    let html = "";

    for (
        const result of results
    ) {

        if (
            result.status ===
            "NOT_FOUND"
        ) {

            html += `
                <div class="sku-group">

                    <div class="sku-heading">
                        ${escapeHtml(result.sku)}
                        <span class="state bad">
                            Not found
                        </span>
                    </div>

                </div>
            `;

            continue;
        }


        html += `
            <div class="sku-group">

                <div class="sku-heading">

                    <strong>
                        ${escapeHtml(result.sku)}
                    </strong>

                    <span>
                        ${result.waitlist_count}
                        waitlist${result.waitlist_count === 1 ? "" : "s"}
                    </span>

                </div>
        `;


        for (
            const waitlist of
            result.waitlists
        ) {

            const encoded =
                escapeHtml(
                    JSON.stringify(
                        waitlist
                    )
                );

            html += `
                <label class="waitlist-row">

                    <input
                        type="checkbox"
                        class="waitlist-check"
                        data-waitlist="${encoded}"
                    >

                    <div class="waitlist-info">

                        <div class="waitlist-title">

                            ${escapeHtml(
                                waitlist.title ||
                                `Waitlist ${waitlist.waitlist_id}`
                            )}

                        </div>

                        <div class="waitlist-meta">

                            ID:
                            ${escapeHtml(
                                waitlist.waitlist_id
                            )}

                            ·

                            State:
                            ${escapeHtml(
                                waitlist.state ||
                                "—"
                            )}

                        </div>

                    </div>

                    <div class="current-dates">

                        <div>
                            <small>Earliest</small>
                            <strong>
                                ${formatDate(
                                    waitlist.earliest_ship_date
                                )}
                            </strong>
                        </div>

                        <div>
                            <small>Latest</small>
                            <strong>
                                ${formatDate(
                                    waitlist.latest_ship_date
                                )}
                            </strong>
                        </div>

                    </div>

                </label>
            `;
        }

        html += `
            </div>
        `;
    }


    $("reviewTable")
        .innerHTML =
        html;


    $("lookupState")
        .textContent =
        `${lookup.matched_count} waitlists found · ` +
        `${lookup.not_found_count} SKUs not found`;


    $("datesCard")
        .classList
        .remove("hidden");


    /*
     * Add checkbox listeners.
     */

    document
        .querySelectorAll(
            ".waitlist-check"
        )
        .forEach(
            checkbox =>
                checkbox.addEventListener(
                    "change",
                    updateSelectionCount
                )
        );


    updateSelectionCount();
}


/* -----------------------------
   Select all / clear
----------------------------- */

if ($("selectAll")) {

    $("selectAll")
        .addEventListener(
            "click",
            selectAll
        );
}


if ($("clearAll")) {

    $("clearAll")
        .addEventListener(
            "click",
            clearAll
        );
}


/* -----------------------------
   Dates
----------------------------- */

$("earliest")
    .addEventListener(
        "change",
        updateDatePreview
    );

$("latest")
    .addEventListener(
        "change",
        updateDatePreview
    );


/* -----------------------------
   Update
----------------------------- */

$("update")
    .addEventListener(
        "click",
        async () => {

            const selected =
                getSelectedWaitlists();

            if (!selected.length) {

                setStatus(
                    "Select at least one waitlist.",
                    "bad"
                );

                return;
            }


            if (!datesValid()) {

                setStatus(
                    "Enter valid new dates.",
                    "bad"
                );

                return;
            }


            const reason =
                $("changeReason")
                    ?.value
                    ?.trim() || "";


            const includeEmail =
                Boolean(
                    $("includeEmail")
                        ?.checked
                );


            if (!reason) {

                setStatus(
                    "Enter a reason for the change.",
                    "bad"
                );

                return;
            }


            const confirmed =
                confirm(
                    `Update ${selected.length} selected waitlist(s)?\n\n` +

                    `New dates:\n` +

                    `${formatDate(
                        $("earliest").value
                    )} → ` +

                    `${formatDate(
                        $("latest").value
                    )}\n\n` +

                    `Reason:\n${reason}\n\n` +

                    `Include reason in customer email: ` +

                    `${
                        includeEmail
                            ? "YES"
                            : "NO"
                    }`
                );


            if (!confirmed) {
                return;
            }


            $("update")
                .disabled =
                true;


            try {

                const branch =
                    $("branch")
                        .value
                        .trim() ||
                    "main";


                const payload =
                    JSON.stringify({

                        waitlists:
                            selected,

                        earliest_ship_date:
                            $("earliest")
                                .value,

                        latest_ship_date:
                            $("latest")
                                .value,

                        reason,

                        include_reason_in_email:
                            includeEmail
                    });


                await githubRequest(
                    "/actions/workflows/purple-dot-update.yml/dispatches",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({

                                ref:
                                    branch,

                                inputs: {
                                    payload
                                }

                            })
                    }
                );


                setStatus(
                    `Update started for ${selected.length} waitlist(s).`,
                    "ok"
                );


            } catch (error) {

                setStatus(
                    error.message,
                    "bad"
                );

                $("update")
                    .disabled =
                    false;
            }
        }
    );


updateDatePreview();
