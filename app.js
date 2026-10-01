const $ = id => document.getElementById(id);

let requested = [];
let lookup = null;
let runId = null;
let pollTimer = null;

function getSkus() {
    return [
        ...new Set(
            $("skus").value
                .split(/[\n,\t,;]+/)
                .map(x => x.trim())
                .filter(Boolean)
        )
    ];
}

function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    }[char]));
}

function setStatus(message, type = "") {
    const status = $("status");

    if (!status) return;

    status.className = `status ${type}`;
    status.textContent = message;
}

function datesValid() {
    const earliest = $("earliest").value;
    const latest = $("latest").value;

    return Boolean(
        earliest &&
        latest &&
        latest >= earliest
    );
}

function updateDatePreview() {
    const earliest = $("earliest");
    const latest = $("latest");
    const earliestPreview = $("earliestPreview");
    const latestPreview = $("latestPreview");
    const update = $("update");

    if (earliestPreview) {
        earliestPreview.textContent =
            formatDate(earliest.value);
    }

    if (latestPreview) {
        latestPreview.textContent =
            formatDate(latest.value);
    }

    if (update) {
        update.disabled =
            !datesValid() ||
            !lookup ||
            !lookup.matched ||
            lookup.matched.length === 0;
    }
}


/* SKU counter */

$("skus").addEventListener("input", () => {
    const list = getSkus();

    $("skuCount").textContent =
        `${list.length} SKU${list.length === 1 ? "" : "s"}`;
});


/* Date fields */

$("earliest").addEventListener(
    "change",
    updateDatePreview
);

$("latest").addEventListener(
    "change",
    updateDatePreview
);


/* GitHub API */

async function githubRequest(path, options = {}) {

    const owner =
        $("repoOwner").value.trim();

    const repo =
        $("repoName").value.trim();

    const token =
        $("githubToken").value.trim();

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

    const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`,
        {
            ...options,

            headers: {
                "Accept":
                    "application/vnd.github+json",

                "Authorization":
                    `Bearer ${token}`,

                "X-GitHub-Api-Version":
                    "2026-03-10",

                ...(options.headers || {})
            }
        }
    );

    const text =
        await response.text();

    if (!response.ok) {

        let message = text;

        try {
            const json = JSON.parse(text);

            if (json.message) {
                message = json.message;
            }
        } catch (e) {
            // Keep original response text.
        }

        throw new Error(
            `GitHub ${response.status}: ${message}`
        );
    }

    if (!text) {
        return null;
    }

    return JSON.parse(text);
}


/* FIND WAITLISTS */

$("find").addEventListener("click", async () => {

    requested = getSkus();

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

    $("lookupState").className =
        "loading";

    $("lookupState").innerHTML =
        '<span class="spinner"></span> Starting Purple Dot lookup…';

    $("reviewTable").innerHTML = "";

    try {

        const branch =
            $("branch").value.trim() ||
            "main";

        /*
         * Check the workflow exists.
         */

        await githubRequest(
            "/actions/workflows/purple-dot-lookup.yml"
        );

        /*
         * Trigger the lookup workflow.
         */

        await githubRequest(
            "/actions/workflows/purple-dot-lookup.yml/dispatches",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    ref: branch,

                    inputs: {
                        skus:
                            requested.join("\n")
                    }
                })
            }
        );

        $("lookupState").innerHTML =
            '<span class="spinner"></span> Purple Dot lookup started…';

        /*
         * Give GitHub a moment to register
         * the workflow.
         */

        setTimeout(
            findLatestLookupRun,
            2500
        );

    } catch (error) {

        $("lookupState").textContent =
            error.message;

        setStatus(
            error.message,
            "bad"
        );
    }
});


/* FIND WORKFLOW RUN */

async function findLatestLookupRun() {

    try {

        const branch =
            $("branch").value.trim() ||
            "main";

        const data =
            await githubRequest(
                `/actions/runs?event=workflow_dispatch&branch=${encodeURIComponent(branch)}&per_page=20`
            );

        const runs =
            data.workflow_runs || [];

        const lookupRuns =
            runs.filter(run =>
                run.path ===
                ".github/workflows/purple-dot-lookup.yml"
            );

        if (!lookupRuns.length) {

            $("lookupState").innerHTML =
                '<span class="spinner"></span> Waiting for GitHub to start the lookup…';

            pollTimer =
                setTimeout(
                    findLatestLookupRun,
                    2000
                );

            return;
        }

        const run =
            lookupRuns[0];

        runId = run.id;

        if (
            run.status === "queued" ||
            run.status === "in_progress"
        ) {

            $("lookupState").innerHTML =
                '<span class="spinner"></span> Purple Dot lookup running…';

            pollTimer =
                setTimeout(
                    findLatestLookupRun,
                    2000
                );

            return;
        }

        if (run.status === "completed") {

            if (
                run.conclusion !== "success"
            ) {

                throw new Error(
                    `Purple Dot lookup failed. GitHub conclusion: ${run.conclusion}`
                );
            }

            await readLookupResult();
        }

    } catch (error) {

        $("lookupState").textContent =
            error.message;

        setStatus(
            error.message,
            "bad"
        );
    }
}


/* READ LOOKUP RESULT */

async function readLookupResult() {

    try {

        $("lookupState").innerHTML =
            '<span class="spinner"></span> Loading lookup results…';

        const artifacts =
            await githubRequest(
                `/actions/runs/${runId}/artifacts`
            );

        const artifact =
            (artifacts.artifacts || []).find(
                item =>
                    item.name ===
                    "purple-dot-lookup-result"
            );

        if (!artifact) {

            throw new Error(
                "The lookup finished but no result file was produced."
            );
        }

        const jobs =
            await githubRequest(
                `/actions/runs/${runId}/jobs?per_page=20`
            );

        const job =
            (jobs.jobs || [])[0];

        if (!job) {

            throw new Error(
                "The lookup job could not be found."
            );
        }

        const owner =
            $("repoOwner").value.trim();

        const repo =
            $("repoName").value.trim();

        const token =
            $("githubToken").value.trim();

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
                            "2026-03-10"
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
            logs.lastIndexOf(marker);

        if (position === -1) {

            throw new Error(
                "The lookup completed, but no result data was found."
            );
        }

        const jsonText =
            logs
                .slice(position + marker.length)
                .split(/\r?\n/)[0]
                .trim();

        lookup =
            JSON.parse(jsonText);

        renderLookup();

    } catch (error) {

        $("lookupState").textContent =
            error.message;

        setStatus(
            error.message,
            "bad"
        );
    }
}


/* DISPLAY RESULTS */

function renderLookup() {

    const rows =
        lookup.results || [];

    $("lookupState").textContent =
        `${lookup.matched_count} matched · ` +
        `${lookup.not_found_count} not found · ` +
        `${lookup.ambiguous_count} ambiguous`;

    let html = `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>SKU</th>
                        <th>Current earliest</th>
                        <th>Current latest</th>
                        <th>State</th>
                        <th>Result</th>
                    </tr>
                </thead>
                <tbody>
    `;

    for (const row of rows) {

        let resultClass = "";
        let resultText = "Ready";

        if (row.status === "NOT_FOUND") {
            resultClass = "bad";
            resultText = "Not found";
        }

        if (row.status === "AMBIGUOUS") {
            resultClass = "warn";
            resultText = "Ambiguous";
        }

        html += `
            <tr>
                <td class="sku">
                    ${escapeHtml(row.sku)}
                </td>

                <td class="date-old">
                    ${formatDate(
                        row.earliest_ship_date
                    )}
                </td>

                <td class="date-old">
                    ${formatDate(
                        row.latest_ship_date
                    )}
                </td>

                <td>
                    ${
                        row.state
                            ? `<span class="state">
                                ${escapeHtml(row.state)}
                               </span>`
                            : "—"
                    }
                </td>

                <td>
                    <span class="state ${resultClass}">
                        ${resultText}
                    </span>
                </td>
            </tr>
        `;
    }

    html += `
                </tbody>
            </table>
        </div>
    `;

    $("reviewTable").innerHTML =
        html;

    $("datesCard")
        .classList
        .remove("hidden");

    updateDatePreview();
}


/* UPDATE PURPLE DOT */

$("update").addEventListener(
    "click",
    async () => {

        if (
            !datesValid() ||
            !lookup ||
            !lookup.matched ||
            !lookup.matched.length
        ) {
            return;
        }

        const confirmed =
            confirm(
                `Update ${lookup.matched.length} matched waitlists?\n\n` +
                `${formatDate(
                    $("earliest").value
                )} → ` +
                `${formatDate(
                    $("latest").value
                )}`
            );

        if (!confirmed) {
            return;
        }

        $("update").disabled = true;

        setStatus(
            "Starting Purple Dot update…"
        );

        try {

            const branch =
                $("branch").value.trim() ||
                "main";

            const payload =
                JSON.stringify({
                    skus:
                        lookup.matched.map(
                            x => x.sku
                        ),

                    earliest_ship_date:
                        $("earliest").value,

                    latest_ship_date:
                        $("latest").value
                });

            await githubRequest(
                "/actions/workflows/purple-dot-update.yml/dispatches",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        ref: branch,

                        inputs: {
                            payload
                        }
                    })
                }
            );

            setStatus(
                "Update workflow started successfully.\n\n" +
                "GitHub Actions is now updating the matched Purple Dot waitlists.",
                "ok"
            );

        } catch (error) {

            setStatus(
                error.message,
                "bad"
            );

            $("update").disabled =
                false;
        }
    }
);
