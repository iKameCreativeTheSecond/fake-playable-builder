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
