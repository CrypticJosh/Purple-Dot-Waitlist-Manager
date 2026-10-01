# Purple Dot Waitlist Manager

A polished GitHub Pages frontend for finding Purple Dot waitlists by SKU, reviewing their current ship dates, entering new dates, and triggering a bulk update.

## Setup

1. Create a GitHub repository and upload this project.
2. Add the Purple Dot private API token as repository secret:
   `Settings → Secrets and variables → Actions → New repository secret`
   Name: `PURPLE_DOT_ACCESS_TOKEN`
3. Enable GitHub Pages using GitHub Actions.
4. Create a GitHub fine-grained Personal Access Token restricted to this repository with **Actions: Read and write**.
5. Open the GitHub Pages website.
6. Enter owner/repository/token.
7. Paste SKUs and click **Find waitlists**.
8. Review the current Purple Dot dates.
9. Enter the new earliest/latest dates.
10. Click **Update selected waitlists**.

## What it does

The lookup workflow retrieves Purple Dot waitlists, follows pagination, matches the supplied SKUs, and returns the current earliest/latest ship dates and state.

The update workflow re-fetches the waitlists, matches the SKUs again, and updates only unambiguous matches. Existing product ID, max-unit allocations and labels are preserved.

Purple Dot documents:
- `GET /admin/api/v1/waitlists` with pagination up to 100 per request.
- `PUT /admin/api/v1/waitlists/:releaseId` for updating an existing waitlist.
- The update endpoint is currently documented as Preview.

## Security

Never put the Purple Dot token in frontend files.

The GitHub token is entered in the browser and used to dispatch/read GitHub Actions. Use a fine-grained token restricted to this repository. Do not commit it.

The page does not save the GitHub token to localStorage.

## Notes

The lookup page uses the GitHub Actions API and job logs to read the result. The GitHub token therefore needs Actions read/write permission as described above.
