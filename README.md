# fake-playable-builder

Minimal static web page that takes:
- a title
- a click URL
- an MP4 video

…and exports a single HTML file based on `assets/templateHTML/Template.html` with the video embedded as a Base64 data URL.

## Run locally

Because the builder loads the template via `fetch()`, you should run it via a local web server (not `file://`).

### Option A: Python

From the repo folder:

```bash
python -m http.server 5173
```

Then open:

- `http://localhost:5173/`

### Option B: Node (if you have it)

```bash
npx serve
```

## Notes

- The exported HTML can be very large because the MP4 is embedded as Base64.

## Deploy to GitLab Pages (CI/CD)

This repo is already a static site (no build step). GitLab Pages can publish it directly.

### 1) Add the CI config

This repo includes a GitLab Pages pipeline at `.gitlab-ci.yml`.

What it does:
- Runs only on the default branch (usually `main`/`master`).
- Copies `index.html`, `assets/`, and `builder/` into a `public/` folder.
- Uploads `public/` as the GitLab Pages artifact.

### 2) Push to GitLab

Commit and push to your GitLab project on the default branch.

### 3) Enable Pages + find your URL

In GitLab:
- Go to **Deploy → Pages** (or **Settings → Pages**, depending on GitLab version).
- After the pipeline succeeds, GitLab shows the Pages URL.

The URL is typically:
- `https://<namespace>.gitlab.io/<project>/`

### Notes

- All asset references in `index.html` are relative, so they work when served under the GitLab Pages subpath.
- The exported single-HTML file is downloaded to your computer (it is not automatically uploaded to GitLab Pages).
