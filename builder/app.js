/* Minimal static builder for assets/templateHTML/Template.html */

const TEMPLATE_PATH = "assets/templateHTML/Template.html";
const CURSOR_GIF_PATH = "assets/cursor/Cursor.gif";

const titleInput = document.getElementById("titleInput");
const clickUrlInput = document.getElementById("clickUrlInput");
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const fileMeta = document.getElementById("fileMeta");
const exportBtn = document.getElementById("exportBtn");
const previewBtn = document.getElementById("previewBtn");
const previewPopoutBtn = document.getElementById("previewPopoutBtn");
const statusEl = document.getElementById("status");
const previewNote = document.getElementById("previewNote");
const previewFrame = document.getElementById("previewFrame");
const controlVideo = document.getElementById("controlVideo");
const timelineEl = document.getElementById("timeline");
const timelineMeta = document.getElementById("timelineMeta");
const statesList = document.getElementById("statesList");
const runtimeStatusEl = document.getElementById("runtimeStatus");
const toastEl = document.getElementById("toast");

const statePrevBtn = document.getElementById("statePrevBtn");
const stateNextBtn = document.getElementById("stateNextBtn");
const stateCounter = document.getElementById("stateCounter");

const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const replayBtn = document.getElementById("replayBtn");
const prevFrameBtn = document.getElementById("prevFrameBtn");
const nextFrameBtn = document.getElementById("nextFrameBtn");

let templateHtml = "";
let selectedFile = null;
let selectedFileObjectUrl = null;

let cursorGifDataUrl = "";
let cursorGifLoadPromise = null;

let videoDuration = 0;
let states = [];
let selectedStateId = null;
let nextStateId = 1;
const stateElements = new Map();

const MIN_GAP_SEC = 0.01;
const FRAME_RATE = 30;

let playheadEl = null;
let previewSyncRaf = 0;

let playheadHandleEl = null;
let isPlayheadDragging = false;

let lastPreviewStateId = null;
let previewWasPlaying = false;
let toastTimer = 0;
let wantPlaying = false;
let isProgrammaticSeek = false;
let _programmaticSeekResetTimer = 0;

let previewPopup = null;

let autoPreviewRequested = false;
let autoPreviewInFlight = false;

const stateRuntimeById = new Map();

function getStateRuntime(id) {
  if (id === null || id === undefined) return null;
  let rt = stateRuntimeById.get(id);
  if (!rt) {
    rt = {
      unlocked: false,
    };
    stateRuntimeById.set(id, rt);
  }
  return rt;
}

function getUnlockedStateId() {
  for (const [id, rt] of stateRuntimeById.entries()) {
    if (rt && rt.unlocked) return id;
  }
  return null;
}

function resetPreviewRuntimeFlags() {
  lastPreviewStateId = null;
  stateRuntimeById.clear();
  updateRuntimeStatus();
}

function updateRuntimeStatus() {
  if (!runtimeStatusEl) return;

  const unlockedId = getUnlockedStateId();
  if (unlockedId === null) {
    runtimeStatusEl.textContent = "";
    runtimeStatusEl.classList.remove("runtime-status--visible");
    return;
  }

  const stateIndex = getStateIndexById(unlockedId);
  if (stateIndex < 0 || stateIndex >= states.length - 1) {
    runtimeStatusEl.textContent = "";
    runtimeStatusEl.classList.remove("runtime-status--visible");
    return;
  }

  const current = states[stateIndex];
  const next = states[stateIndex + 1];
  runtimeStatusEl.textContent = `Runtime: State ${stateIndex + 1} will continue to State ${stateIndex + 2} at ${formatTime(current.end)}. Settings unchanged.`;
  runtimeStatusEl.classList.add("runtime-status--visible");
}

function showToast(message, durationMs = 3000) {
  if (!toastEl) return;
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.add("toast--visible");
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("toast--visible");
  }, durationMs);
}

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
  if (previewBtn) previewBtn.disabled = !canExport;
  if (previewPopoutBtn) previewPopoutBtn.disabled = !canExport;

  const canNavigateStates = Boolean(selectedFile) && Number.isFinite(videoDuration) && videoDuration > 0 && states.length > 0;
  if (statePrevBtn) statePrevBtn.disabled = !canNavigateStates;
  if (stateNextBtn) stateNextBtn.disabled = !canNavigateStates;

  const hasVideoMeta = Boolean(selectedFile) && Number.isFinite(videoDuration) && videoDuration > 0;
  timelineEl.setAttribute("aria-disabled", String(!hasVideoMeta));

  const canControlPreview = Boolean(selectedFileObjectUrl) && hasVideoMeta;
  playBtn.disabled = !canControlPreview;
  pauseBtn.disabled = !canControlPreview;
  replayBtn.disabled = !canControlPreview;
  prevFrameBtn.disabled = !canControlPreview;
  nextFrameBtn.disabled = !canControlPreview;
}

function updateStateNavButtons() {
  if (!statePrevBtn && !stateNextBtn) return;
  if (!Number.isFinite(videoDuration) || videoDuration <= 0 || states.length === 0) {
    if (statePrevBtn) statePrevBtn.disabled = true;
    if (stateNextBtn) stateNextBtn.disabled = true;
    return;
  }
  const idx = getStateIndexById(selectedStateId);
  const i = idx >= 0 ? idx : 0;
  if (statePrevBtn) statePrevBtn.disabled = i <= 0;
  if (stateNextBtn) stateNextBtn.disabled = i >= states.length - 1;
}

function updateStateCounter() {
  if (!stateCounter) return;
  if (!Number.isFinite(videoDuration) || videoDuration <= 0 || states.length === 0) {
    stateCounter.textContent = "";
    return;
  }
  const idx = getStateIndexById(selectedStateId);
  const i = idx >= 0 ? idx : 0;
  stateCounter.textContent = `State ${i + 1} / ${states.length}`;
}

async function maybeAutoRenderIframePreview() {
  if (!autoPreviewRequested) return;
  if (autoPreviewInFlight) return;
  if (!templateHtml || !selectedFile) return;
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) return;
  if (!selectedFileObjectUrl) return;
  if (!states || states.length === 0) return;

  autoPreviewInFlight = true;
  try {
    await renderPreview();
    autoPreviewRequested = false;
  } finally {
    autoPreviewInFlight = false;
  }
}

function ensurePreviewPopupOpened() {
  if (previewPopup && !previewPopup.closed) return previewPopup;
  try {
    previewPopup = window.open("about:blank", "_blank");
    if (previewPopup) {
      try { previewPopup.focus(); } catch { /* ignore */ }
    }
  } catch {
    previewPopup = null;
  }
  return previewPopup;
}

function getIframeDocument() {
  try {
    return previewFrame.contentDocument;
  } catch {
    return null;
  }
}

function getPopupDocument() {
  try {
    if (previewPopup && !previewPopup.closed) return previewPopup.document;
  } catch {
    // ignore
  }
  return null;
}

function getPreviewDocuments() {
  const docs = [];
  const iframeDoc = getIframeDocument();
  if (iframeDoc) docs.push({ kind: "iframe", doc: iframeDoc });
  return docs;
}

function wirePreviewOverlayAndSync(doc) {
  // Attach overlay click listener (for openOnClick/exitOnClick simulation).
  try {
    if (doc) {
      const overlay = doc.getElementById("overlay");
      if (overlay) {
        // Avoid stacking listeners across reloads.
        if (overlay.__builderPreviewClickHandler) {
          try { overlay.removeEventListener("click", overlay.__builderPreviewClickHandler); } catch { /* ignore */ }
        }

        const handler = () => {
          const cur = selectStateByTimeBiased(controlVideo.currentTime || 0, lastPreviewStateId);
          if (!cur) return;

          const curIdx = getStateIndexById(cur.id);

          if (cur.exitOnClick && states[curIdx + 1]) {
            const rt = getStateRuntime(cur.id);
            if (rt) rt.unlocked = true;
            setAllCurrentTimeKeepingPlay(cur.end);
            return;
          }

          if (cur.loop) {
            const next = states[curIdx + 1];
            if (next) {
              const rt = getStateRuntime(cur.id);
              if (rt) rt.unlocked = true;
              updateRuntimeStatus();
              showToast(`Will continue to State ${curIdx + 2} at ${formatTime(cur.end)}.`);
            }
          }

          if (cur.openOnClick) previewTriggerDownload("Open download on click");
        };

        overlay.__builderPreviewClickHandler = handler;
        overlay.addEventListener("click", handler);
      }
    }
  } catch {
    // ignore
  }

  // Wait for preview video to finish its own .load() call before seeking.
  const trySync = (attemptsLeft) => {
    const vids = getPreviewVideos(doc);
    if (!vids) {
      if (attemptsLeft > 0) setTimeout(() => trySync(attemptsLeft - 1), 80);
      return;
    }

    // If any state uses the cursor, make sure this preview doc has it injected.
    if (states.some((s) => s && s.cursorOn)) {
      void ensurePreviewCursorInjected(doc).then(() => {
        runPreviewStateMachine();
      });
    }

    syncPreviewToControl(true);
    runPreviewStateMachine();
    if (previewWasPlaying) {
      previewWasPlaying = false;
      playAll();
    }
  };
  setTimeout(() => trySync(5), 100);
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
    void maybeAutoRenderIframePreview();
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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function ensureCursorGifDataUrl() {
  if (cursorGifDataUrl) return cursorGifDataUrl;
  if (cursorGifLoadPromise) return cursorGifLoadPromise;

  cursorGifLoadPromise = (async () => {
    const res = await fetch(CURSOR_GIF_PATH, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to load cursor GIF: ${CURSOR_GIF_PATH} (${res.status})`);
    }
    const blob = await res.blob();
    cursorGifDataUrl = String(await blobToDataUrl(blob));
    return cursorGifDataUrl;
  })().finally(() => {
    cursorGifLoadPromise = null;
  });

  return cursorGifLoadPromise;
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

  if (selectedFileObjectUrl) {
    URL.revokeObjectURL(selectedFileObjectUrl);
    selectedFileObjectUrl = null;
  }

  videoDuration = 0;
  states = [];
  selectedStateId = null;
  resetPreviewRuntimeFlags();
  timelineMeta.textContent = "";
  renderTimeline();
  renderStates();

  previewFrame.removeAttribute("srcdoc");
  previewFrame.removeAttribute("src");
  previewNote.textContent = file ? "Loading preview..." : "Select an MP4 to preview.";

  if (!file) {
    fileMeta.textContent = "No file selected";
    controlVideo.removeAttribute("src");
    controlVideo.load();
    updateUiState();
    return;
  }

  selectedFileObjectUrl = URL.createObjectURL(file);
  controlVideo.src = selectedFileObjectUrl;
  controlVideo.load();

  // Auto-render preview once metadata is loaded and states are initialized.
  autoPreviewRequested = true;

  const name = file.name || "(unnamed)";
  const size = formatBytes(file.size);
  fileMeta.textContent = `${name} — ${size}`;
  updateUiState();
}

async function renderPreview() {
  if (!templateHtml || !selectedFile) return;

  const title = titleInput.value.trim() || "Playable";
  const clickUrl = clickUrlInput.value.trim() || "";
  const cursorWanted = states.some((s) => Boolean(s && s.cursorOn));

  if (!selectedFileObjectUrl) return;

  let cursorDataUrl = "";
  if (cursorWanted) {
    try {
      setStatus("Loading cursor GIF...");
      cursorDataUrl = await ensureCursorGifDataUrl();
    } catch (err) {
      setStatus("Failed to load cursor GIF (export/preview may miss cursor). See console.");
      // eslint-disable-next-line no-console
      console.error(err);
      cursorDataUrl = "";
    } finally {
      // If we previously set a loading/error status, clear it for the preview flow.
      if (statusEl.textContent.startsWith("Loading cursor GIF")) setStatus("");
    }
  }

  const out = applyInputsToTemplate(templateHtml, {
    title,
    videoDataUrl: selectedFileObjectUrl,
    clickUrl,
  });

  const withStates = applyStatesToTemplate(out, states, clickUrl, cursorDataUrl);

  const previewOut = withStates.replace(
    /<head(\s*)>/i,
    (m) => `${m}\n    <script>window.__BUILDER_PREVIEW__ = true;</script>`
  );

  // Reset state-entry tracker so openOnEnter fires correctly after reload.
  resetPreviewRuntimeFlags();

  // Pause before reloading so controlVideo.currentTime is stable when the
  // load handler later calls syncPreviewToControl; resume afterwards.
  previewWasPlaying = !controlVideo.paused;
  if (previewWasPlaying) pauseAll();

  // Always refresh iframe preview.
  previewFrame.srcdoc = previewOut;
  previewNote.textContent = "Preview updated. Thay đổi state (loop, flags, timing) có hiệu lực ngay — không cần bấm Preview lại.";
}

async function renderPopoutFinalPreview() {
  if (!templateHtml || !selectedFile) return;

  const title = titleInput.value.trim() || "Playable";
  const clickUrl = clickUrlInput.value.trim() || "";
  const cursorWanted = states.some((s) => Boolean(s && s.cursorOn));

  if (!selectedFileObjectUrl) return;

  let cursorDataUrl = "";
  if (cursorWanted) {
    try {
      setStatus("Loading cursor GIF...");
      cursorDataUrl = await ensureCursorGifDataUrl();
    } catch (err) {
      setStatus("Failed to load cursor GIF (export/preview may miss cursor). See console.");
      // eslint-disable-next-line no-console
      console.error(err);
      cursorDataUrl = "";
    } finally {
      if (statusEl.textContent.startsWith("Loading cursor GIF")) setStatus("");
    }
  }

  const out = applyInputsToTemplate(templateHtml, {
    title,
    videoDataUrl: selectedFileObjectUrl,
    clickUrl,
  });
  const finalOut = applyStatesToTemplate(out, states, clickUrl, cursorDataUrl);

  const w = ensurePreviewPopupOpened();
  if (!w) {
    setStatus("Popup blocked. Please allow popups for this page.");
    return;
  }
  try { w.focus(); } catch { /* ignore */ }

  // IMPORTANT: No __BUILDER_PREVIEW__ flag here.
  // This makes the popup behave like the exported HTML (runs handlerLogic).
  try {
    w.document.open();
    w.document.write(finalOut);
    w.document.close();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  previewNote.textContent = "New window preview opened (export-like, independent). It does NOT sync time with the iframe preview.";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function formatTime(valueSec) {
  if (!Number.isFinite(valueSec)) return "";
  return `${valueSec.toFixed(2)}s`;
}

function snapToFrame(timeSec) {
  const t = Number(timeSec);
  if (!Number.isFinite(t)) return 0;
  return Math.round(t * FRAME_RATE) / FRAME_RATE;
}

function getStateIndexById(id) {
  return states.findIndex((s) => s.id === id);
}

function getSelectedState() {
  const index = getStateIndexById(selectedStateId);
  return index >= 0 ? states[index] : null;
}

function getStateById(id) {
  const index = getStateIndexById(id);
  return index >= 0 ? states[index] : null;
}

function setSelectedState(id) {
  selectedStateId = id;
  renderTimeline();
  renderStates();
  updateStateNavButtons();
  updateStateCounter();
}

function resetStates(durationSec) {
  const duration = Math.max(0, Number(durationSec) || 0);
  videoDuration = duration;
  states = [];

  if (duration <= 0) {
    selectedStateId = null;
    renderTimeline();
    renderStates();
    updateUiState();
    return;
  }

  const first = {
    id: nextStateId++,
    start: 0,
    end: duration,
    loop: false,
    exitOnClick: false,
    openOnEnter: false,
    openOnClick: false,
    cursorOn: false,
    cursorX: 50,
    cursorY: 50,
    cursorScale: 100,
  };
  states.push(first);
  selectedStateId = first.id;
  renderTimeline();
  renderStates();
  updateStateCounter();
  updateUiState();
}

function getPreviewCursorEl(doc) {
  try {
    if (!doc) return null;
    return doc.getElementById("builderCursor");
  } catch {
    return null;
  }
}

async function ensurePreviewCursorInjected(doc) {
  try {
    if (!doc) return false;
    if (doc.getElementById("builderCursor")) return true;

    const dataUrl = await ensureCursorGifDataUrl();

    // Style: add once.
    if (!doc.getElementById("builderCursorStyle")) {
      const style = doc.createElement("style");
      style.id = "builderCursorStyle";
      style.textContent = `
#builderCursor {
  position: fixed;
  left: 50%;
  top: 50%;
  width: 96px;
  height: 96px;
  transform: translate(-50%, -50%);
  z-index: 10000;
  pointer-events: none;
  display: none;
}
`;
      doc.head.appendChild(style);
    }

    const img = doc.createElement("img");
    img.id = "builderCursor";
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.src = dataUrl;

    (doc.body || doc.documentElement).appendChild(img);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return false;
  }
}

async function ensurePreviewCursorInjectedAll() {
  const docs = getPreviewDocuments();
  if (!docs.length) return;
  await Promise.all(docs.map(({ doc }) => ensurePreviewCursorInjected(doc)));
}

function applyPreviewCursorForStateInDoc(doc, state) {
  const el = getPreviewCursorEl(doc);
  if (!el) return;

  if (!state || !state.cursorOn) {
    el.style.display = "none";
    return;
  }

  const xRaw = Number(state.cursorX);
  const yRaw = Number(state.cursorY);
  const xPct = Number.isFinite(xRaw) ? clamp(xRaw, 0, 100) : 50;
  const yPct = Number.isFinite(yRaw) ? clamp(yRaw, 0, 100) : 50;
  const scaleRaw = Number(state.cursorScale);
  const scale = (Number.isFinite(scaleRaw) ? clamp(scaleRaw, 10, 300) : 100) / 100;

  // Position cursor relative to the visible video rect so it stays anchored
  // even when the video scales/crops with different screen resolutions.
  const vids = getPreviewVideos(doc);
  const videoEl = vids?.main || null;
  if (!videoEl) {
    el.style.display = "block";
    el.style.left = `${xPct}%`;
    el.style.top = `${yPct}%`;
    return;
  }

  const rect = videoEl.getBoundingClientRect();
  if (!rect || !rect.width || !rect.height) {
    el.style.display = "block";
    el.style.left = `${xPct}%`;
    el.style.top = `${yPct}%`;
    return;
  }

  const xPx = rect.left + (xPct / 100) * rect.width;
  const yPx = rect.top + (yPct / 100) * rect.height;
  el.style.display = "block";
  el.style.left = `${xPx}px`;
  el.style.top = `${yPx}px`;
  el.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function applyPreviewCursorForState(state) {
  for (const { doc } of getPreviewDocuments()) {
    applyPreviewCursorForStateInDoc(doc, state);
  }
}

function renderTimeline() {
  timelineEl.innerHTML = "";
  if (!Number.isFinite(videoDuration) || videoDuration <= 0 || states.length === 0) {
    timelineEl.style.opacity = "0.6";
    return;
  }
  timelineEl.style.opacity = "1";

  const frag = document.createDocumentFragment();
  for (const s of states) {
    const seg = document.createElement("div");
    seg.className = "timeline__seg" + (s.id === selectedStateId ? " timeline__seg--selected" : "");
    const frac = (s.end - s.start) / videoDuration;
    seg.style.flex = `${Math.max(frac, 0)} 0 0`;
    seg.title = `${formatTime(s.start)} → ${formatTime(s.end)}`;
    frag.appendChild(seg);
  }
  timelineEl.appendChild(frag);

  playheadEl = document.createElement("div");
  playheadEl.className = "timeline__playhead";
  playheadEl.style.left = "0px";
  playheadHandleEl = document.createElement("div");
  playheadHandleEl.className = "timeline__handle";
  playheadEl.appendChild(playheadHandleEl);
  timelineEl.appendChild(playheadEl);

  wirePlayheadHandleDrag();
  updatePlayhead();
}

function updateTimelineMeta() {
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
    timelineMeta.textContent = "";
    return;
  }
  const t = Number.isFinite(controlVideo.currentTime) ? controlVideo.currentTime : 0;
  const selected = getSelectedState();
  const selectedText = selected ? ` • Selected: ${formatTime(selected.start)} → ${formatTime(selected.end)}` : "";
  timelineMeta.textContent = `Time: ${formatTime(t)} / ${formatTime(videoDuration)}${selectedText}`;
}

function updatePlayhead() {
  if (!playheadEl) return;
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
    playheadEl.style.display = "none";
    return;
  }

  const rect = timelineEl.getBoundingClientRect();
  if (!rect.width) return;

  playheadEl.style.display = "block";
  const t = clamp(controlVideo.currentTime || 0, 0, videoDuration);
  const ratio = videoDuration ? t / videoDuration : 0;
  playheadEl.style.left = `${ratio * rect.width}px`;
}

function getPreviewVideos(doc) {
  try {
    if (!doc) return null;
    const main = doc.getElementById("video");
    const bg = doc.getElementById("background-video");
    if (!main || !bg) return null;
    return { main, bg };
  } catch {
    return null;
  }
}

function stopPreviewSyncLoop() {
  if (previewSyncRaf) {
    cancelAnimationFrame(previewSyncRaf);
    previewSyncRaf = 0;
  }
}

function openDownload() {
  const url = clickUrlInput.value.trim();
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

// In builder preview: show toast feedback instead of (or in addition to) opening URL.
// "openOnEnter" fires from RAF — window.open would be popup-blocked by the browser.
function previewTriggerDownload(trigger) {
  const url = clickUrlInput.value.trim();
  const urlLabel = url ? url : "(chưa điền Click URL)";
  showToast(`🔗 ${trigger}: ${urlLabel}`);
  // For click-based trigger the parent context IS a user gesture — try to open too.
  if (trigger === "Open download on click" && url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function runPreviewStateMachine() {
  if (!Number.isFinite(videoDuration) || videoDuration <= 0 || states.length === 0) return;

  const t = controlVideo.currentTime;
  const previousState = lastPreviewStateId !== null ? getStateById(lastPreviewStateId) : null;
  const threshold = 1 / FRAME_RATE;

  // Loop guard: check the PREVIOUSLY active state first.
  // Reason: if a RAF tick jumps past cur.end in one frame, selectStateByTime
  // already returns the NEXT state — so checking loop on 'cur' would be too late.
  if (previousState && previousState.loop && wantPlaying && t >= previousState.end - threshold) {
    const prevRt = getStateRuntime(previousState.id);
    const isUnlocked = Boolean(prevRt && prevRt.unlocked);

    // Default: loop back.
    // If user unlocked this loop state, allow it to continue naturally.
    if (!isUnlocked) {
      setAllCurrentTimeKeepingPlay(previousState.start);
      return;
    }
  }

  const cur = selectStateByTimeBiased(t, lastPreviewStateId);
  if (!cur) return;

  // Cursor preview is driven from the parent (Template's handlerLogic is skipped in preview mode).
  applyPreviewCursorForState(cur);

  // Detect state entry (only fires once per transition).
  if (cur.id !== lastPreviewStateId) {
    // Leaving previous state: clear its transient runtime so it can't bleed.
    if (lastPreviewStateId !== null) {
      const prevRt = getStateRuntime(lastPreviewStateId);
      if (prevRt) prevRt.unlocked = false;
    }

    lastPreviewStateId = cur.id;
    if (cur.openOnEnter) previewTriggerDownload("Open download on enter");
    updateRuntimeStatus();
  }

  // Loop guard on current state (handles the common in-state case).
  if (
    cur.loop
    && wantPlaying
    && t >= cur.end - threshold
  ) {
    const curRt = getStateRuntime(cur.id);
    const isUnlocked = Boolean(curRt && curRt.unlocked);
    if (!isUnlocked) {
      setAllCurrentTimeKeepingPlay(cur.start);
    }
  }
}

function startPreviewSyncLoop() {
  stopPreviewSyncLoop();
  const tick = () => {
    updatePlayhead();
    runPreviewStateMachine();
    syncPreviewToControl(false);
    // Keep the loop alive as long as wantPlaying is true, even if controlVideo
    // is momentarily paused due to a seek (loop-back seek during play).
    if (wantPlaying || (!controlVideo.paused && !controlVideo.ended)) {
      previewSyncRaf = requestAnimationFrame(tick);
    } else {
      previewSyncRaf = 0;
    }
  };
  previewSyncRaf = requestAnimationFrame(tick);
}

function syncPreviewToControl(forceSeek) {
  const docs = getPreviewDocuments();
  if (!docs.length) return;
  const t = clamp(controlVideo.currentTime || 0, 0, videoDuration || 0);

  // Some browsers occasionally leave <video> visually stuck after a forced
  // seek while playing. In preview we can safely "kick" playback after the
  // seek completes (never call play() while seeking).
  const scheduleKickAfterSeek = (v) => {
    if (!v) return;
    if (!wantPlaying) return;

    const tryKick = () => {
      if (!wantPlaying) return;
      try {
        if (v.seeking) return;
        v.play().catch(() => {
          // ignore
        });
      } catch {
        // ignore
      }
    };

    try {
      v.addEventListener("seeked", tryKick, { once: true });
      v.addEventListener("canplay", tryKick, { once: true });
    } catch {
      // ignore
    }

    setTimeout(tryKick, 120);
    setTimeout(tryKick, 260);
  };

  for (const { doc } of docs) {
    const vids = getPreviewVideos(doc);
    if (!vids) continue;

    // Seek while playing (no pause). Seeking-while-playing = brief decode hiccup.
    // Explicit pause→seek→play = visible freeze for the full decode window.
    // NEVER call play() during an active seek — that causes the "stuck frame" bug.
    [vids.main, vids.bg].forEach((v) => {
      const cur = Number.isFinite(v.currentTime) ? v.currentTime : 0;
      if (forceSeek || Math.abs(cur - t) > 0.06) {
        try { v.currentTime = t; } catch { /* ignore */ }
        scheduleKickAfterSeek(v);
      }
    });

    if (!wantPlaying) {
      if (!vids.main.paused) vids.main.pause();
      if (!vids.bg.paused) vids.bg.pause();
    } else {
      // Only resume if paused AND not mid-seek.
      if (vids.main.paused && !vids.main.seeking) vids.main.play().catch(() => {});
      if (vids.bg.paused && !vids.bg.seeking) vids.bg.play().catch(() => {});
    }
  }
}

function setAllCurrentTime(timeSec) {
  const t = clamp(timeSec, 0, videoDuration || 0);
  // Flag this seek as programmatic so controlVideo.seeked doesn't call
  // syncPreviewToControl(true) a second time — the call below already covers it.
  isProgrammaticSeek = true;
  clearTimeout(_programmaticSeekResetTimer);
  _programmaticSeekResetTimer = setTimeout(() => { isProgrammaticSeek = false; }, 400);
  controlVideo.currentTime = t;
  updateTimelineMeta();
  updatePlayhead();
  syncPreviewToControl(true);
}

function setAllCurrentTimeKeepingPlay(timeSec) {
  const shouldPlay = wantPlaying;
  setAllCurrentTime(timeSec);
  if (!shouldPlay) return;

  // Some browsers pause controlVideo momentarily during a programmatic seek.
  // Re-play it when seeked completes; wantPlaying=true means syncPreviewToControl
  // will already keep the iframe videos playing regardless of controlVideo.paused.
  const onSeeked = () => {
    if (wantPlaying && controlVideo.paused) {
      controlVideo.play().catch(() => {});
    }
  };
  try {
    controlVideo.addEventListener("seeked", onSeeked, { once: true });
  } catch {
    // ignore
  }
  // Fallback in case seeked doesn't fire.
  setTimeout(() => {
    if (wantPlaying && controlVideo.paused) {
      controlVideo.play().catch(() => {});
    }
  }, 80);
}

function setAllCurrentTimeSnapped(timeSec) {
  setAllCurrentTime(snapToFrame(timeSec));
}

function playAll() {
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) return;
  wantPlaying = true;
  controlVideo.play().then(() => {
    syncPreviewToControl(true);
    startPreviewSyncLoop();
  }).catch(() => {
    wantPlaying = false;
  });
}

function pauseAll() {
  wantPlaying = false;
  controlVideo.pause();
  stopPreviewSyncLoop();
  syncPreviewToControl(false);
}

function stepByFrames(frameDelta) {
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) return;
  pauseAll();
  const step = frameDelta / FRAME_RATE;
  setAllCurrentTime((controlVideo.currentTime || 0) + step);
}

function splitSelectedStateAt(timeSec) {
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) return;
  const selectedIndex = getStateIndexById(selectedStateId);
  if (selectedIndex < 0) return;

  const s = states[selectedIndex];
  const t = clamp(timeSec, s.start + MIN_GAP_SEC, s.end - MIN_GAP_SEC);
  if (!(t > s.start && t < s.end)) return;

  const left = {
    ...s,
    id: nextStateId++,
    start: s.start,
    end: t,
  };
  const right = {
    ...s,
    id: nextStateId++,
    start: t,
    end: s.end,
  };

  states.splice(selectedIndex, 1, left, right);
  selectedStateId = right.id;
  renderTimeline();
  renderStates();
  updateTimelineMeta();
}

function selectStateByTime(timeSec) {
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) return null;
  const t = clamp(timeSec, 0, videoDuration);
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const isLast = i === states.length - 1;
    if (t >= s.start && (t < s.end || (isLast && t <= s.end))) return s;
  }
  return null;
}

function selectStateByTimeBiased(timeSec, biasStateId) {
  const picked = selectStateByTime(timeSec);
  const bias = biasStateId !== null && biasStateId !== undefined ? getStateById(biasStateId) : null;
  if (!bias) return picked;

  // When seeking to a boundary (e.g. looping to state.start), browsers can land a
  // few milliseconds BEFORE the requested time. That would classify into the
  // previous state and can trigger its loop.
  const t = clamp(timeSec, 0, videoDuration || 0);
  const eps = 1 / FRAME_RATE;
  if (t < bias.start && t >= bias.start - eps) return bias;

  return picked;
}

function removeState(id) {
  if (states.length <= 1) return;
  const index = getStateIndexById(id);
  if (index < 0) return;

  if (index === 0) {
    // Merge into next
    states[1].start = 0;
    states.splice(0, 1);
    selectedStateId = states[0].id;
  } else {
    // Merge into previous
    states[index - 1].end = states[index].end;
    states.splice(index, 1);
    selectedStateId = states[Math.min(index - 1, states.length - 1)].id;
  }

  renderTimeline();
  renderStates();
  updateTimelineMeta();
  updateStateCounter();
}

function renderStates() {
  statesList.innerHTML = "";
  stateElements.clear();
  if (!Number.isFinite(videoDuration) || videoDuration <= 0 || states.length === 0) {
    return;
  }

  // Render only the selected state.
  let idx = getStateIndexById(selectedStateId);
  if (idx < 0) idx = 0;
  const s = states[idx];
  if (!s) return;

  const frag = document.createDocumentFragment();
  const wrap = document.createElement("div");
  wrap.className = "state state--selected";
  stateElements.set(s.id, wrap);

  const title = document.createElement("div");
  title.className = "state__title";

  const name = document.createElement("div");
  name.className = "state__name";
  name.textContent = `State ${idx + 1}`;

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "btn btn--secondary";
  delBtn.textContent = "Delete";
  delBtn.disabled = states.length <= 1;
  delBtn.addEventListener("click", (e) => {
    e.preventDefault();
    removeState(s.id);
    updateStateNavButtons();
  });

  title.appendChild(name);
  title.appendChild(delBtn);
  wrap.appendChild(title);

  const row = document.createElement("div");
  row.className = "state__row";

  const startField = document.createElement("div");
  startField.className = "field";
  const startLabel = document.createElement("label");
  startLabel.className = "label";
  startLabel.textContent = "Start time (s)";
  const startInput = document.createElement("input");
  startInput.className = "input";
  startInput.type = "number";
  startInput.step = "0.01";
  startInput.value = String(s.start.toFixed(2));
  startInput.disabled = idx === 0;
  startInput.addEventListener("change", () => {
    const i = getStateIndexById(s.id);
    if (i <= 0) return;
    const prev = states[i - 1];
    const cur = states[i];
    const proposed = Number(startInput.value);
    const nextMin = prev.start + MIN_GAP_SEC;
    const nextMax = cur.end - MIN_GAP_SEC;
    const t = clamp(proposed, nextMin, nextMax);
    prev.end = t;
    cur.start = t;
    renderTimeline();
    renderStates();
    updateTimelineMeta();
    updateStateNavButtons();
  });
  startField.appendChild(startLabel);
  startField.appendChild(startInput);

  const endField = document.createElement("div");
  endField.className = "field";
  const endLabel = document.createElement("label");
  endLabel.className = "label";
  endLabel.textContent = "End time (s)";
  const endInput = document.createElement("input");
  endInput.className = "input";
  endInput.type = "number";
  endInput.step = "0.01";
  endInput.value = String(s.end.toFixed(2));
  endInput.disabled = idx === states.length - 1;
  endInput.addEventListener("change", () => {
    const i = getStateIndexById(s.id);
    if (i < 0 || i >= states.length - 1) return;
    const cur = states[i];
    const next = states[i + 1];
    const proposed = Number(endInput.value);
    const nextMin = cur.start + MIN_GAP_SEC;
    const nextMax = next.end - MIN_GAP_SEC;
    const t = clamp(proposed, nextMin, nextMax);
    cur.end = t;
    next.start = t;
    renderTimeline();
    renderStates();
    updateTimelineMeta();
    updateStateNavButtons();
  });
  endField.appendChild(endLabel);
  endField.appendChild(endInput);

  row.appendChild(startField);
  row.appendChild(endField);
  wrap.appendChild(row);

  const checks = document.createElement("div");
  checks.className = "state__checks";

  const mkCheck = (labelText, checked, onChange) => {
    const label = document.createElement("label");
    label.className = "check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(checked);
    input.addEventListener("change", () => onChange(input.checked));
    const txt = document.createElement("span");
    txt.textContent = labelText;
    label.appendChild(input);
    label.appendChild(txt);
    return label;
  };

  checks.appendChild(
    mkCheck("Loop", s.loop, (v) => {
      const i = getStateIndexById(s.id);
      if (i < 0) return;
      states[i].loop = v;
    })
  );

  checks.appendChild(
    mkCheck("Exit on click", s.exitOnClick, (v) => {
      const i = getStateIndexById(s.id);
      if (i < 0) return;
      states[i].exitOnClick = v;
    })
  );

  checks.appendChild(
    mkCheck("Open download on enter", s.openOnEnter, (v) => {
      const i = getStateIndexById(s.id);
      if (i < 0) return;
      states[i].openOnEnter = v;
    })
  );

  checks.appendChild(
    mkCheck("Open download on click", s.openOnClick, (v) => {
      const i = getStateIndexById(s.id);
      if (i < 0) return;
      states[i].openOnClick = v;
    })
  );

  wrap.appendChild(checks);

  // Cursor controls (hidden unless cursorOn is enabled)
  const cursorConfig = document.createElement("div");
  cursorConfig.className = "cursor-config";

  const cursorCheckLabel = document.createElement("label");
  cursorCheckLabel.className = "check";
  const cursorCheckInput = document.createElement("input");
  cursorCheckInput.type = "checkbox";
  cursorCheckInput.checked = Boolean(s.cursorOn);
  const cursorCheckText = document.createElement("span");
  cursorCheckText.textContent = "Cursor (GIF)";
  cursorCheckLabel.appendChild(cursorCheckInput);
  cursorCheckLabel.appendChild(cursorCheckText);
  checks.appendChild(cursorCheckLabel);

  const nudge = document.createElement("div");
  nudge.className = "cursor-nudge";

  const mkNudgeBtn = (text, title, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn--secondary btn--tiny";
    b.textContent = text;
    b.title = title;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      onClick();
    });
    return b;
  };

  const cursorRow = document.createElement("div");
  cursorRow.className = "state__row";

  const xField = document.createElement("div");
  xField.className = "field";
  const xLabel = document.createElement("label");
  xLabel.className = "label";
  xLabel.textContent = "Cursor X (% of video)";
  const xInput = document.createElement("input");
  xInput.className = "input";
  xInput.type = "number";
  xInput.step = "1";
  xInput.min = "0";
  xInput.max = "100";
  const xVal = Number(s.cursorX);
  xInput.value = String(Number.isFinite(xVal) ? clamp(xVal, 0, 100) : 50);
  xInput.addEventListener("change", () => {
    const i = getStateIndexById(s.id);
    if (i < 0) return;
    const proposed = Number(xInput.value);
    const nextVal = Number.isFinite(proposed) ? clamp(proposed, 0, 100) : 50;
    states[i].cursorX = nextVal;
    xInput.value = String(nextVal);
    runPreviewStateMachine();
  });
  xField.appendChild(xLabel);
  xField.appendChild(xInput);

  const yField = document.createElement("div");
  yField.className = "field";
  const yLabel = document.createElement("label");
  yLabel.className = "label";
  yLabel.textContent = "Cursor Y (% of video)";
  const yInput = document.createElement("input");
  yInput.className = "input";
  yInput.type = "number";
  yInput.step = "1";
  yInput.min = "0";
  yInput.max = "100";
  const yVal = Number(s.cursorY);
  yInput.value = String(Number.isFinite(yVal) ? clamp(yVal, 0, 100) : 50);
  yInput.addEventListener("change", () => {
    const i = getStateIndexById(s.id);
    if (i < 0) return;
    const proposed = Number(yInput.value);
    const nextVal = Number.isFinite(proposed) ? clamp(proposed, 0, 100) : 50;
    states[i].cursorY = nextVal;
    yInput.value = String(nextVal);
    runPreviewStateMachine();
  });
  yField.appendChild(yLabel);
  yField.appendChild(yInput);

  cursorRow.appendChild(xField);
  cursorRow.appendChild(yField);

  const scaleField = document.createElement("div");
  scaleField.className = "field";
  const scaleLabel = document.createElement("label");
  scaleLabel.className = "label";
  scaleLabel.textContent = "Cursor scale (%)";
  const scaleInput = document.createElement("input");
  scaleInput.className = "input";
  scaleInput.type = "number";
  scaleInput.step = "5";
  scaleInput.min = "10";
  scaleInput.max = "300";
  const scaleVal = Number(s.cursorScale);
  scaleInput.value = String(Number.isFinite(scaleVal) ? clamp(scaleVal, 10, 300) : 100);
  scaleInput.addEventListener("change", () => {
    const i = getStateIndexById(s.id);
    if (i < 0) return;
    const proposed = Number(scaleInput.value);
    const nextVal = Number.isFinite(proposed) ? clamp(proposed, 10, 300) : 100;
    states[i].cursorScale = nextVal;
    scaleInput.value = String(nextVal);
    runPreviewStateMachine();
  });
  scaleField.appendChild(scaleLabel);
  scaleField.appendChild(scaleInput);

  const nudgeBy = (dx, dy) => {
    const i = getStateIndexById(s.id);
    if (i < 0) return;
    const curX = Number(states[i].cursorX);
    const curY = Number(states[i].cursorY);
    const x = clamp((Number.isFinite(curX) ? curX : 50) + dx, 0, 100);
    const y = clamp((Number.isFinite(curY) ? curY : 50) + dy, 0, 100);
    states[i].cursorX = x;
    states[i].cursorY = y;
    xInput.value = String(Math.round(x));
    yInput.value = String(Math.round(y));
    runPreviewStateMachine();
  };

  // Horizontal row (above scale field)
  nudge.appendChild(mkNudgeBtn("←", "Move left (1% of video)", () => nudgeBy(-1, 0)));
  nudge.appendChild(mkNudgeBtn("↑", "Move up (1% of video)", () => nudgeBy(0, -1)));
  nudge.appendChild(mkNudgeBtn("↓", "Move down (1% of video)", () => nudgeBy(0, 1)));
  nudge.appendChild(mkNudgeBtn("→", "Move right (1% of video)", () => nudgeBy(1, 0)));

  cursorConfig.appendChild(scaleField);
  cursorConfig.appendChild(cursorRow);
  cursorConfig.appendChild(nudge);
  wrap.appendChild(cursorConfig);

  const setCursorConfigVisible = (visible) => {
    cursorConfig.style.display = visible ? "" : "none";
  };
  setCursorConfigVisible(Boolean(s.cursorOn));

  cursorCheckInput.addEventListener("change", () => {
    const i = getStateIndexById(s.id);
    if (i < 0) return;
    const v = Boolean(cursorCheckInput.checked);
    states[i].cursorOn = v;
    setCursorConfigVisible(v);

    if (v) {
      // If preview was rendered before cursor was enabled, inject it now.
      void ensurePreviewCursorInjectedAll().then(() => {
        runPreviewStateMachine();
      });
    } else {
      runPreviewStateMachine();
    }
  });

  frag.appendChild(wrap);

  statesList.appendChild(frag);
  updateStateNavButtons();
  updateStateCounter();
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

// ─── Export state-machine injection ─────────────────────────────────────────

function buildExportHandlerCode(states, clickUrl) {
  const statesJson = JSON.stringify(
    states.map((s) => ({
      start: parseFloat(s.start.toFixed(4)),
      end: parseFloat(s.end.toFixed(4)),
      loop: Boolean(s.loop),
      exitOnClick: Boolean(s.exitOnClick),
      openOnEnter: Boolean(s.openOnEnter),
      openOnClick: Boolean(s.openOnClick),
      cursorOn: Boolean(s.cursorOn),
      cursorX: Number.isFinite(Number(s.cursorX)) ? clamp(Number(s.cursorX), 0, 100) : 50,
      cursorY: Number.isFinite(Number(s.cursorY)) ? clamp(Number(s.cursorY), 0, 100) : 50,
      cursorScale: Number.isFinite(Number(s.cursorScale)) ? clamp(Number(s.cursorScale), 10, 300) : 100,
    })),
    null,
    4
  );
  const urlJson = JSON.stringify(String(clickUrl || ""));

  return `// @@BUILDER_HANDLER_START@@
        function handlerLogic() {
            var _v = document.getElementById('video');
            var _bg = document.getElementById('background-video');
          var _cursor = document.getElementById('builderCursor');
            // Disable native loop — state machine controls all looping.
            _v.loop = false;
            _bg.loop = false;
            var _states = ${statesJson};
            var _url = ${urlJson};
            var _idx = 0;
            var _unlocked = false;
            var _thr = 1 / 30;
          function _clamp(n, lo, hi) {
            n = Number(n);
            if (!isFinite(n)) return lo;
            return Math.min(Math.max(n, lo), hi);
          }
          function _applyCursor() {
            if (!_cursor || !_v) return;
            var c = _states[_idx];
            if (!c || !c.cursorOn) { _cursor.style.display = 'none'; return; }
            var rect = _v.getBoundingClientRect();
            if (!rect || !rect.width || !rect.height) { _cursor.style.display = 'none'; return; }

            var xPct = _clamp(c.cursorX, 0, 100);
            var yPct = _clamp(c.cursorY, 0, 100);
            var x = rect.left + (xPct / 100) * rect.width;
            var y = rect.top + (yPct / 100) * rect.height;
            var sc = _clamp(c.cursorScale, 10, 300) / 100;
            _cursor.style.display = 'block';
            _cursor.style.left = x + 'px';
            _cursor.style.top = y + 'px';
            _cursor.style.transform = 'translate(-50%, -50%) scale(' + sc + ')';
          }
            function _open() {
                if (!_url) return;
                if (window.mraid) { window.mraid.open(_url); }
                else { window.open(_url, '_blank'); }
            }
            window.__bClick = function () {
                var c = _states[_idx];
                if (!c) return;
                // exitOnClick: skip to the next state immediately.
                if (c.exitOnClick && _idx < _states.length - 1) {
                    _idx++;
                    _unlocked = false;
                    state = _idx + 1;
                    _v.currentTime = _bg.currentTime = _states[_idx].start;
                    if (_states[_idx].openOnEnter) _open();
              _applyCursor();
                    return;
                }
                if (c.openOnClick) _open();
                // Unlock a looping state so it can advance to the next state after
                // the current loop iteration finishes naturally.
                if (c.loop && !_unlocked && _idx < _states.length - 1) _unlocked = true;
            };
            _v.addEventListener('loadedmetadata', function () {
                state = 1;
                if (_states.length && _states[0].openOnEnter) _open();
            _applyCursor();
                requestAnimationFrame(_tick);
            });
            try { window.addEventListener('resize', _applyCursor); } catch (e) {}
            function _tick() {
                var t = _v.currentTime;
                var c = _states[_idx];
                if (c) {
                    if (c.loop && !_unlocked) {
                        // Loop back to state start.
                        if (t >= c.end - _thr) { _v.currentTime = _bg.currentTime = c.start; }
                    } else if (_idx < _states.length - 1 && t >= c.end - _thr) {
                        // Advance to next state.
                        _idx++;
                        _unlocked = false;
                        state = _idx + 1;
                        if (_states[_idx].openOnEnter) _open();
                _applyCursor();
                    }
                }
                requestAnimationFrame(_tick);
            }
        }
        // @@BUILDER_HANDLER_END@@`;
}

    function injectCursorIntoTemplate(html, cursorDataUrl) {
      if (!cursorDataUrl) return html;
      let out = html;

      // Add cursor CSS into the first <style> block.
      out = out.replace(
      /<style>([\s\S]*?)<\/style>/i,
      (m, cssText) => `<style>${cssText}\n\n        #builderCursor {\n            position: fixed;\n            left: 50%;\n            top: 50%;\n            width: 96px;\n            height: 96px;\n            transform: translate(-50%, -50%);\n            z-index: 10000;\n            pointer-events: none;\n            display: none;\n        }\n    </style>`
      );

      // Add cursor element once, near the end of <body>.
      if (!out.includes('id="builderCursor"')) {
      out = out.replace(
        /<\/body>/i,
        `    <img id="builderCursor" aria-hidden="true" alt="" src="${cursorDataUrl}" />\n</body>`
      );
      }

      return out;
    }

    function applyStatesToTemplate(html, states, clickUrl, cursorDataUrl) {
  if (!states || states.length === 0) return html;
  let out = html;

  // Replace handlerLogic() with generated state machine.
  out = out.replace(
    /\/\/ @@BUILDER_HANDLER_START@@[\s\S]*?\/\/ @@BUILDER_HANDLER_END@@/,
    buildExportHandlerCode(states, clickUrl)
  );

  // Replace eventClick() to delegate to the generated click handler.
  out = out.replace(
    /\/\/ @@BUILDER_CLICK_START@@[\s\S]*?\/\/ @@BUILDER_CLICK_END@@/,
    `// @@BUILDER_CLICK_START@@
        function eventClick(event) {
            if (window.__bClick) window.__bClick();
        }
        // @@BUILDER_CLICK_END@@`
  );

  out = injectCursorIntoTemplate(out, cursorDataUrl);

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────

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
  const cursorWanted = states.some((s) => Boolean(s && s.cursorOn));

  try {
    exportBtn.disabled = true;
    let cursorDataUrl = "";
    if (cursorWanted) {
      setStatus("Loading cursor GIF...");
      cursorDataUrl = await ensureCursorGifDataUrl();
    }

    setStatus("Converting video to Base64... (may take a while)");

    const videoDataUrl = await mp4ToDataUrl(selectedFile);

    setStatus("Generating HTML...");
    const out = applyInputsToTemplate(templateHtml, {
      title,
      videoDataUrl,
      clickUrl,
    });
    const finalOut = applyStatesToTemplate(out, states, clickUrl, cursorDataUrl);

    setStatus("Downloading...");
    const filename = `${toSafeFilename(title)}.html`;
    downloadHtml(filename, finalOut);

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
if (previewBtn) {
  previewBtn.addEventListener("click", async () => {
    if (!templateHtml) {
      setStatus("Template not loaded.");
      return;
    }
    if (!selectedFile) {
      setStatus("Choose an MP4 first.");
      return;
    }
    setStatus("");
    await renderPreview();
  });
}

if (previewPopoutBtn) {
  previewPopoutBtn.addEventListener("click", async () => {
    if (!templateHtml) {
      setStatus("Template not loaded.");
      return;
    }
    if (!selectedFile) {
      setStatus("Choose an MP4 first.");
      return;
    }

    // Must run on user gesture to avoid popup blockers.
    setStatus("");
    await renderPopoutFinalPreview();
  });
}

if (statePrevBtn) {
  statePrevBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const idx = getStateIndexById(selectedStateId);
    const i = idx >= 0 ? idx : 0;
    if (i <= 0) return;
    setSelectedState(states[i - 1].id);
    updateTimelineMeta();
  });
}

if (stateNextBtn) {
  stateNextBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const idx = getStateIndexById(selectedStateId);
    const i = idx >= 0 ? idx : 0;
    if (i >= states.length - 1) return;
    setSelectedState(states[i + 1].id);
    updateTimelineMeta();
  });
}

// Timeline interaction: click selects a segment; clicking again on selected segment splits it.
timelineEl.addEventListener("click", (e) => {
  if (!Number.isFinite(videoDuration) || videoDuration <= 0 || states.length === 0) return;

  const time = snapToFrame(getTimelineTimeFromClientX(e.clientX));
  const hit = selectStateByTime(time);
  if (!hit) return;

  if (hit.id !== selectedStateId) {
    setSelectedState(hit.id);
    return;
  }

  splitSelectedStateAt(time);
});

function getTimelineTimeFromClientX(clientX) {
  const rect = timelineEl.getBoundingClientRect();
  if (!rect.width) return 0;
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  return videoDuration * ratio;
}

function wirePlayheadHandleDrag() {
  if (!playheadHandleEl) return;

  playheadHandleEl.addEventListener("pointerdown", (e) => {
    if (!Number.isFinite(videoDuration) || videoDuration <= 0) return;
    e.preventDefault();
    e.stopPropagation();

    resetPreviewRuntimeFlags();
    isPlayheadDragging = true;
    pauseAll();
    setAllCurrentTimeSnapped(getTimelineTimeFromClientX(e.clientX));

    try {
      playheadHandleEl.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  });

  playheadHandleEl.addEventListener("pointermove", (e) => {
    if (!isPlayheadDragging) return;
    if (!Number.isFinite(videoDuration) || videoDuration <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    setAllCurrentTimeSnapped(getTimelineTimeFromClientX(e.clientX));
  });

  const stop = (e) => {
    if (!isPlayheadDragging) return;
    isPlayheadDragging = false;
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  playheadHandleEl.addEventListener("pointerup", stop);
  playheadHandleEl.addEventListener("pointercancel", stop);
}

timelineEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  // Split at current playhead when using keyboard.
  splitSelectedStateAt(controlVideo.currentTime || 0);
});

controlVideo.addEventListener("loadedmetadata", () => {
  resetStates(controlVideo.duration);
  updateTimelineMeta();
  updatePlayhead();
  void maybeAutoRenderIframePreview();
});

controlVideo.addEventListener("timeupdate", () => {
  updateTimelineMeta();
  updatePlayhead();
  runPreviewStateMachine();
  syncPreviewToControl(false);
});

// Keep timeline meta fresh even if timeupdate doesn't fire (paused).
controlVideo.addEventListener("seeked", () => {
  updateTimelineMeta();
  updatePlayhead();
  if (isProgrammaticSeek) {
    // Our code already called syncPreviewToControl(true) inside setAllCurrentTime.
    // Calling it again here would re-pause iframe videos mid-play → visible freeze.
    isProgrammaticSeek = false;
    clearTimeout(_programmaticSeekResetTimer);
    return;
  }
  runPreviewStateMachine();
  // User-initiated seek (native browser scrubbar, etc.) — sync iframe to match.
  syncPreviewToControl(true);
});

controlVideo.addEventListener("play", () => {
  startPreviewSyncLoop();
});

controlVideo.addEventListener("pause", () => {
  stopPreviewSyncLoop();
});

// If the last state has loop=true and the video file reaches its natural end,
// restart the loop manually (since the controlVideo has loop=false).
controlVideo.addEventListener("ended", () => {
  if (!Number.isFinite(videoDuration) || videoDuration <= 0 || states.length === 0) return;
  const last = states[states.length - 1];
  if (last && last.loop) {
    setAllCurrentTime(last.start);
    playAll();
  }
});

// Wire openOnClick for the preview overlay.
// Also sync playhead and resume play state after every iframe reload.
previewFrame.addEventListener("load", () => {
  // Iframe finished loading; wire overlay click + re-sync.
  const doc = getIframeDocument();
  if (doc) wirePreviewOverlayAndSync(doc);
});

// Preview controls
playBtn.addEventListener("click", () => {
  playAll();
});

pauseBtn.addEventListener("click", () => {
  pauseAll();
});

replayBtn.addEventListener("click", () => {
  resetPreviewRuntimeFlags();
  setAllCurrentTime(0);
  playAll();
});

prevFrameBtn.addEventListener("click", () => {
  resetPreviewRuntimeFlags();
  stepByFrames(-1);
});

nextFrameBtn.addEventListener("click", () => {
  resetPreviewRuntimeFlags();
  stepByFrames(1);
});

// Init
loadTemplate();
updateUiState();

// Keep preview cursor anchored if the builder layout/iframe size changes.
window.addEventListener("resize", () => {
  runPreviewStateMachine();
});
