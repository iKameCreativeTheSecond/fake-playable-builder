/* Minimal static builder for assets/templateHTML/Template.html */

const TEMPLATE_PATH = "assets/templateHTML/Template.html";

const titleInput = document.getElementById("titleInput");
const clickUrlInput = document.getElementById("clickUrlInput");
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const fileMeta = document.getElementById("fileMeta");
const exportBtn = document.getElementById("exportBtn");
const previewBtn = document.getElementById("previewBtn");
const statusEl = document.getElementById("status");
const previewNote = document.getElementById("previewNote");
const previewFrame = document.getElementById("previewFrame");

let templateHtml = "";
let selectedFile = null;
let previewVideoObjectUrl = null;

function setStatus(message) {
  statusEl.textContent = message || "";
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jsStringLiteral(value) {
  return JSON.stringify(String(value ?? ""));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  const fixed = unitIndex === 0 ? 0 : 2;
  return `${size.toFixed(fixed)} ${units[unitIndex]}`;
}

function updateUiState() {
  const canExport = Boolean(templateHtml) && Boolean(selectedFile);
  exportBtn.disabled = !canExport;
  previewBtn.disabled = !canExport;
}

async function loadTemplate() {
  try {
    setStatus("Loading template...");
    const res = await fetch(TEMPLATE_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    templateHtml = await res.text();
    setStatus("Template loaded.");
  } catch (err) {
    templateHtml = "";
    setStatus(
      "Failed to load template. Run this page via a local server (not file://)."
    );
    // eslint-disable-next-line no-console
    console.error(err);
  } finally {
    updateUiState();
  }
}

function mp4ToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function applyInputsToTemplate(inputTemplate, { title, videoDataUrl, clickUrl }) {
  let out = inputTemplate;

  // 1) <title>...</title>
  out = out.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${escapeHtml(title)}</title>`
  );

  // 2) let mp4_portrait = "..."
  out = out.replace(
    /let\s+mp4_portrait\s*=\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')\s*;?/,
    `let mp4_portrait = ${jsStringLiteral(videoDataUrl)};`
  );

  // 3) const linkDownload = "...";
  out = out.replace(
    /const\s+linkDownload\s*=\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')\s*;/,
    `const linkDownload = ${jsStringLiteral(clickUrl)};`
  );

  return out;
}

function downloadHtml(filename, htmlText) {
  const blob = new Blob([htmlText], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toSafeFilename(inputName) {
  const raw = String(inputName ?? "").trim();
  const base = raw.length ? raw : "Playable";
  const withoutIllegal = base.replace(/[\\/:*?"<>|]/g, "-");
  const collapsed = withoutIllegal.replace(/\s+/g, " ").trim();
  const withoutTrailingDotsSpaces = collapsed.replace(/[.\s]+$/g, "");
  const truncated = withoutTrailingDotsSpaces.slice(0, 120);
  return truncated.length ? truncated : "Playable";
}

function setSelectedFile(file) {
  selectedFile = file;
  if (previewVideoObjectUrl) {
    URL.revokeObjectURL(previewVideoObjectUrl);
    previewVideoObjectUrl = null;
  }
  previewFrame.removeAttribute("srcdoc");
  previewFrame.removeAttribute("src");
  previewNote.textContent = file ? "Ready to preview." : "Click Preview after selecting an MP4.";

  if (!file) {
    fileMeta.textContent = "No file selected";
    updateUiState();
    return;
  }

  const name = file.name || "(unnamed)";
  const size = formatBytes(file.size);
  fileMeta.textContent = `${name} — ${size}`;
  updateUiState();
}

function renderPreview() {
  if (!templateHtml || !selectedFile) return;

  const title = titleInput.value.trim() || "Playable";
  const clickUrl = clickUrlInput.value.trim() || "";

  if (previewVideoObjectUrl) {
    URL.revokeObjectURL(previewVideoObjectUrl);
  }
  previewVideoObjectUrl = URL.createObjectURL(selectedFile);

  const out = applyInputsToTemplate(templateHtml, {
    title,
    videoDataUrl: previewVideoObjectUrl,
    clickUrl,
  });

  // srcdoc avoids extra file creation and refreshes instantly.
  previewFrame.srcdoc = out;
  previewNote.textContent = "Preview updated.";
}

// Drag & drop events
["dragenter", "dragover"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add("drop-zone--active");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("drop-zone--active");
  });
});

dropZone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0] || null;
  if (!file) return;
  if (file.type !== "video/mp4") {
    setStatus("Please drop an MP4 file.");
    return;
  }
  setStatus("");
  setSelectedFile(file);
});

// File chooser
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0] || null;
  if (!file) {
    setSelectedFile(null);
    return;
  }
  if (file.type !== "video/mp4") {
    setStatus("Please choose an MP4 file.");
    fileInput.value = "";
    setSelectedFile(null);
    return;
  }
  setStatus("");
  setSelectedFile(file);
});

// Export
exportBtn.addEventListener("click", async () => {
  if (!templateHtml) {
    setStatus("Template not loaded.");
    return;
  }
  if (!selectedFile) {
    setStatus("Choose an MP4 first.");
    return;
  }

  const title = titleInput.value.trim() || "Playable";
  const clickUrl = clickUrlInput.value.trim() || "";

  try {
    exportBtn.disabled = true;
    setStatus("Converting video to Base64... (may take a while)");

    const videoDataUrl = await mp4ToDataUrl(selectedFile);

    setStatus("Generating HTML...");
    const out = applyInputsToTemplate(templateHtml, {
      title,
      videoDataUrl,
      clickUrl,
    });

    setStatus("Downloading...");
    const filename = `${toSafeFilename(title)}.html`;
    downloadHtml(filename, out);

    setStatus("Done.");
  } catch (err) {
    setStatus("Export failed. See console for details.");
    // eslint-disable-next-line no-console
    console.error(err);
  } finally {
    updateUiState();
  }
});

// Preview
previewBtn.addEventListener("click", () => {
  if (!templateHtml) {
    setStatus("Template not loaded.");
    return;
  }
  if (!selectedFile) {
    setStatus("Choose an MP4 first.");
    return;
  }
  setStatus("");
  renderPreview();
});

// Init
loadTemplate();
updateUiState();
