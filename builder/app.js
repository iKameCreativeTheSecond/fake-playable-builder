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
const controlVideo = document.getElementById("controlVideo");
const timelineEl = document.getElementById("timeline");
const timelineMeta = document.getElementById("timelineMeta");
const statesList = document.getElementById("statesList");
const runtimeStatusEl = document.getElementById("runtimeStatus");
const toastEl = document.getElementById("toast");

const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const replayBtn = document.getElementById("replayBtn");
const prevFrameBtn = document.getElementById("prevFrameBtn");
const nextFrameBtn = document.getElementById("nextFrameBtn");

let templateHtml = "";
let selectedFile = null;
let selectedFileObjectUrl = null;

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
  previewBtn.disabled = !canExport;

  const hasVideoMeta = Boolean(selectedFile) && Number.isFinite(videoDuration) && videoDuration > 0;
  timelineEl.setAttribute("aria-disabled", String(!hasVideoMeta));

  const canControlPreview = Boolean(selectedFileObjectUrl) && hasVideoMeta;
  playBtn.disabled = !canControlPreview;
  pauseBtn.disabled = !canControlPreview;
  replayBtn.disabled = !canControlPreview;
  prevFrameBtn.disabled = !canControlPreview;
  nextFrameBtn.disabled = !canControlPreview;
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
  previewNote.textContent = file ? "Ready to preview." : "Click Preview after selecting an MP4.";

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

  const name = file.name || "(unnamed)";
  const size = formatBytes(file.size);
  fileMeta.textContent = `${name} — ${size}`;
  updateUiState();
}

function renderPreview() {
  if (!templateHtml || !selectedFile) return;

  const title = titleInput.value.trim() || "Playable";
  const clickUrl = clickUrlInput.value.trim() || "";

  if (!selectedFileObjectUrl) return;

  const out = applyInputsToTemplate(templateHtml, {
    title,
    videoDataUrl: selectedFileObjectUrl,
    clickUrl,
  });

  const previewOut = out.replace(
    /<head(\s*)>/i,
    (m) => `${m}\n    <script>window.__BUILDER_PREVIEW__ = true;</script>`
  );

  // Reset state-entry tracker so openOnEnter fires correctly after reload.
  resetPreviewRuntimeFlags();

  // Pause before reloading so controlVideo.currentTime is stable when the
  // load handler later calls syncPreviewToControl; resume afterwards.
  previewWasPlaying = !controlVideo.paused;
  if (previewWasPlaying) pauseAll();

  // srcdoc avoids extra file creation and refreshes instantly.
  previewFrame.srcdoc = previewOut;
  previewNote.textContent = "Preview updated. Thay đổi state (loop, flags, timing) có hiệu lực ngay — không cần bấm Preview lại.";
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
  if (selectedStateId !== null) {
    const old = stateElements.get(selectedStateId);
    if (old) old.classList.remove("state--selected");
  }
  selectedStateId = id;
  if (id !== null) {
    const el = stateElements.get(id);
    if (el) el.classList.add("state--selected");
  }
  renderTimeline();
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
    openOnEnter: false,
    openOnClick: false,
  };
  states.push(first);
  selectedStateId = first.id;
  renderTimeline();
  renderStates();
  updateUiState();
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

function getPreviewVideos() {
  try {
    const doc = previewFrame.contentDocument;
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
  const vids = getPreviewVideos();
  if (!vids) return;
  const t = clamp(controlVideo.currentTime || 0, 0, videoDuration || 0);

  // Seek while playing (no pause). Seeking-while-playing = brief decode hiccup.
  // Explicit pause→seek→play = visible freeze for the full decode window.
  // NEVER call play() during an active seek — that causes the "stuck frame" bug.
  [vids.main, vids.bg].forEach((v) => {
    const cur = Number.isFinite(v.currentTime) ? v.currentTime : 0;
    if (forceSeek || Math.abs(cur - t) > 0.06) {
      try { v.currentTime = t; } catch { /* ignore */ }
    }
  });

  if (!wantPlaying) {
    if (!vids.main.paused) vids.main.pause();
    if (!vids.bg.paused) vids.bg.pause();
  } else {
    // Only resume if paused AND not mid-seek (calling play() during a seek
    // interrupts the decode in some browsers, leaving the video on the stale frame).
    if (vids.main.paused && !vids.main.seeking) vids.main.play().catch(() => {});
    if (vids.bg.paused && !vids.bg.seeking) vids.bg.play().catch(() => {});
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
}

function renderStates() {
  statesList.innerHTML = "";
  stateElements.clear();
  if (!Number.isFinite(videoDuration) || videoDuration <= 0 || states.length === 0) {
    return;
  }

  const frag = document.createDocumentFragment();
  states.forEach((s, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "state" + (s.id === selectedStateId ? " state--selected" : "");
    stateElements.set(s.id, wrap);

    // Selecting a state card only toggles CSS (no DOM rebuild).
    wrap.addEventListener("pointerdown", () => setSelectedState(s.id));

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
    });

    title.addEventListener("click", () => setSelectedState(s.id));

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
    frag.appendChild(wrap);
  });

  statesList.appendChild(frag);
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
      openOnEnter: Boolean(s.openOnEnter),
      openOnClick: Boolean(s.openOnClick),
    })),
    null,
    4
  );
  const urlJson = JSON.stringify(String(clickUrl || ""));

  return `// @@BUILDER_HANDLER_START@@
        function handlerLogic() {
            var _v = document.getElementById('video');
            var _bg = document.getElementById('background-video');
            // Disable native loop — state machine controls all looping.
            _v.loop = false;
            _bg.loop = false;
            var _states = ${statesJson};
            var _url = ${urlJson};
            var _idx = 0;
            var _unlocked = false;
            var _thr = 1 / 30;
            function _open() {
                if (!_url) return;
                if (window.mraid) { window.mraid.open(_url); }
                else { window.open(_url, '_blank'); }
            }
            window.__bClick = function () {
                var c = _states[_idx];
                if (!c) return;
                if (c.openOnClick) _open();
                // Unlock a looping state so it can advance to the next state after
                // the current loop iteration finishes naturally.
                if (c.loop && !_unlocked && _idx < _states.length - 1) _unlocked = true;
            };
            _v.addEventListener('loadedmetadata', function () {
                state = 1;
                if (_states.length && _states[0].openOnEnter) _open();
                requestAnimationFrame(_tick);
            });
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
                    }
                }
                requestAnimationFrame(_tick);
            }
        }
        // @@BUILDER_HANDLER_END@@`;
}

function applyStatesToTemplate(html, states, clickUrl) {
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
    const finalOut = applyStatesToTemplate(out, states, clickUrl);

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
});

controlVideo.addEventListener("timeupdate", () => {
  updateTimelineMeta();
  updatePlayhead();
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
  // Attach overlay click listener immediately (doesn't require video to be ready).
  try {
    const doc = previewFrame.contentDocument;
    if (doc) {
      const overlay = doc.getElementById("overlay");
      if (overlay) {
        overlay.addEventListener("click", () => {
          const cur = selectStateByTimeBiased(controlVideo.currentTime || 0, lastPreviewStateId);
          if (!cur) return;

          // If this is a loop state, clicking allows it to continue into the
          // next state when the current loop reaches its end.
          if (cur.loop) {
            const curIdx = getStateIndexById(cur.id);
            const next = states[curIdx + 1];
            if (next) {
              const rt = getStateRuntime(cur.id);
              if (rt) rt.unlocked = true;
              updateRuntimeStatus();
              showToast(`Will continue to State ${curIdx + 2} at ${formatTime(cur.end)}.`);
            }
          }

          if (cur.openOnClick) previewTriggerDownload("Open download on click");
        });
      }
    }
  } catch {
    // Cross-origin guard — safe to ignore.
  }

  // Wait for the iframe video to finish its own .load() call before seeking;
  // otherwise the seek is silently dropped (race with video.load() in Template).
  // Retry up to 5 times, 80ms apart (~400ms max).
  const trySync = (attemptsLeft) => {
    const vids = getPreviewVideos();
    if (!vids) {
      if (attemptsLeft > 0) setTimeout(() => trySync(attemptsLeft - 1), 80);
      return;
    }
    syncPreviewToControl(true);
    if (previewWasPlaying) {
      previewWasPlaying = false;
      playAll();
    }
  };
  setTimeout(() => trySync(5), 100);
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
