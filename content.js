// ===== Utilities =====
const EXT_NS = "gdr-rotator";
const STORAGE_PREFIX = "gdr:rotation:";
const TOOLBAR_ID = "gdr-rotator-toolbar";

let currentFileId = null;
let currentTarget = null;
let angle = 0; // in degrees
let flipX = false; // mirror horizontally
let initAttempts = 0;
const MAX_INIT_ATTEMPTS = 20;

// Debounce helper
function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function isDriveFilePreviewUrl(url = location.href) {
  // Match both /view and /preview URLs
  return /https:\/\/drive\.google\.com\/file\/d\/[^/]+\/(view|preview)/.test(url);
}

function isDriveUrl(url = location.href) {
  return url.includes('drive.google.com');
}

function getFileIdFromUrl(url = location.href) {
  const m = url.match(/\/file\/d\/([^/]+)/);
  return m ? m[1] : null;
}

function log(msg) {
  console.log(`[Drive Rotate Viewer] ${msg}`);
}

function saveState(fileId, state) {
  if (!fileId) return;
  const key = STORAGE_PREFIX + fileId;
  chrome.storage.local.set({ [key]: state }).catch(() => {});
}

function loadState(fileId) {
  return new Promise((resolve) => {
    if (!fileId) return resolve(null);
    const key = STORAGE_PREFIX + fileId;
    chrome.storage.local.get(key, (obj) => {
      resolve(obj[key] || null);
    });
  });
}

// Pick the biggest visible <img> or <video> as our target
function findLargestMediaElement() {
  // Multiple selectors for different Google Drive layouts
  const selectors = [
    // Current Google Drive preview selectors (2024)
    '[data-testid="preview-image"] img',
    '[data-testid="preview-video"] video', 
    '[role="main"] img',
    '[role="main"] video',
    '[aria-label*="preview"] img',
    '[aria-label*="preview"] video',
    // Legacy and fallback selectors
    'img[src*="googleusercontent.com"]',
    'video[src*="googleusercontent.com"]',
    'img[src*="docs.google.com"]',
    'video[src*="docs.google.com"]',
    '[role="img"] img',
    '.ndfHFb-c4YZDc img',
    '.ndfHFb-c4YZDc video',
    // Very broad fallbacks
    'img[src*="drive.google.com"]',
    'video[src*="drive.google.com"]',
    'img',
    'video'
  ];

  log("Starting media element search...");
  let allCandidates = [];
  
  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll(selector));
    log(`Selector "${selector}" found ${elements.length} elements`);
    
    const filtered = elements.filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      
      // Log details for debugging
      log(`  Element: ${el.tagName}, rect: ${rect.width}x${rect.height}, src: ${el.src || 'none'}, display: ${style.display}, visibility: ${style.visibility}`);
      
      // Basic visibility checks
      if (!rect || rect.width < 30 || rect.height < 30) return false;
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      
      // More lenient visibility check
      if (!el.offsetParent && style.position !== "fixed" && style.position !== "absolute") return false;
      
      // Size requirements - be more lenient for popup previews
      const w = el.naturalWidth || el.videoWidth || rect.width;
      const h = el.naturalHeight || el.videoHeight || rect.height;
      
      if (w < 50 || h < 50) return false;
      
      // Skip obvious icons/thumbnails by checking src patterns
      if (el.src && (el.src.includes('icon') || el.src.includes('thumbnail') || el.src.includes('favicon'))) {
        return false;
      }
      
      return true;
    });
    
    if (filtered.length > 0) {
      log(`Selector "${selector}" yielded ${filtered.length} valid elements`);
      allCandidates.push(...filtered);
      break; // Use first successful selector
    }
  }

  if (allCandidates.length === 0) {
    log("No suitable media elements found after filtering");
    
    // Debug: Show all img/video elements for troubleshooting
    const allMedia = document.querySelectorAll('img, video');
    log(`Total img/video elements on page: ${allMedia.length}`);
    allMedia.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      log(`  [${i}] ${el.tagName}: ${rect.width}x${rect.height}, src: ${el.src || 'none'}, classes: ${el.className}`);
    });
    
    return null;
  }

  // Sort by size, biggest first
  allCandidates.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return (rb.width * rb.height) - (ra.width * ra.height);
  });

  const selected = allCandidates[0];
  const rect = selected.getBoundingClientRect();
  log(`Selected media element: ${selected.tagName} (${rect.width}x${rect.height}) src: ${selected.src || 'no src'}`);
  return selected;
}

function applyTransform() {
  if (!currentTarget) return;
  const rotate = `rotate(${angle}deg)`;
  const flip = flipX ? " scaleX(-1)" : "";
  currentTarget.classList.add("gdr-rot-target");
  currentTarget.style.transform = rotate + flip;
  currentTarget.style.objectFit =
    currentTarget.tagName === "VIDEO"
      ? "contain"
      : currentTarget.style.objectFit;
  currentTarget.style.maxWidth = "100%";
  currentTarget.style.maxHeight = "100%";
}

function setTarget(el) {
  if (!el) return;
  currentTarget = el;
  applyTransform();
}

function updateToolbarStatus(message) {
  const toolbar = document.getElementById(TOOLBAR_ID);
  if (!toolbar) return;
  
  const statusEl = toolbar.querySelector('.gdr-status');
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function ensureToolbar() {
  if (document.getElementById(TOOLBAR_ID)) {
    log("Toolbar already exists");
    return;
  }

  log("Creating rotation toolbar");
  const bar = document.createElement("div");
  bar.id = TOOLBAR_ID;
  
  // Show status in toolbar when no media is found
  const isPreviewPage = isDriveFilePreviewUrl();
  const statusText = isPreviewPage ? "Looking for media..." : "Navigate to file preview";
  
  bar.innerHTML = `
    <button title="Rotate Left (Shift+L)" data-action="left">⟲ 90°</button>
    <button title="Rotate Right (Shift+R)" data-action="right">⟳ 90°</button>
    <div class="gdr-divider"></div>
    <button title="Flip Horizontal (Shift+F)" data-action="flip">⇋ Flip</button>
    <div class="gdr-divider"></div>
    <button title="Reset (Shift+0)" data-action="reset">Reset</button>
    <div class="gdr-divider"></div>
    <span class="gdr-status">${statusText}</span>
  `;
  
  // Add to body instead of documentElement for better compatibility
  document.body.appendChild(bar);
  log("Toolbar created and added to DOM");

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action === "left") angle = (angle - 90 + 360) % 360;
    if (action === "right") angle = (angle + 90) % 360;
    if (action === "flip") flipX = !flipX;
    if (action === "reset") {
      angle = 0;
      flipX = false;
    }
    applyTransform();
    saveState(currentFileId, { angle, flipX });
  });

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    // ignore when typing
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable)
    )
      return;

    if (!e.shiftKey) return;
    if (e.key.toLowerCase() === "r") {
      angle = (angle + 90) % 360;
      e.preventDefault();
    } else if (e.key.toLowerCase() === "l") {
      angle = (angle - 90 + 360) % 360;
      e.preventDefault();
    } else if (e.key === "0") {
      angle = 0;
      flipX = false;
      e.preventDefault();
    } else if (e.key.toLowerCase() === "f") {
      flipX = !flipX;
      e.preventDefault();
    } else return;

    applyTransform();
    saveState(currentFileId, { angle, flipX });
  });
}

// Load saved rotation state for current file
async function loadRotationState() {
  if (!currentFileId) return;
  
  const saved = await loadState(currentFileId);
  angle = saved?.angle ?? 0;
  flipX = saved?.flipX ?? false;
  log(`Loaded rotation state - angle: ${angle}, flipX: ${flipX}`);
  
  // Apply to current target if we have one
  if (currentTarget) {
    applyTransform();
  }
}

function teardown() {
  // Optional: remove toolbar & reset state when leaving preview
  // We’ll keep toolbar so it’s ready if user opens another file.
  currentTarget = null;
}

// Detect URL changes in SPA navigation
(function watchUrlChanges() {
  let last = location.href;
  const tick = () => {
    const now = location.href;
    if (now !== last) {
      log(`URL changed from ${last} to ${now}`);
      last = now;
      
      // Update file ID and load state for new files
      const newFileId = getFileIdFromUrl() || "general";
      if (newFileId !== currentFileId) {
        currentFileId = newFileId;
        log(`File ID changed to: ${currentFileId}`);
        loadRotationState(); // Load saved state for this file
      }
      
      // Reset search attempts on URL change
      initAttempts = 0;
    }
    requestAnimationFrame(tick);
  };
  tick();
})();

// Initialize on any Google Drive page and continuously watch for media
async function initOnDrive() {
  log("Initializing on Google Drive page");
  currentFileId = getFileIdFromUrl() || "general"; // Use "general" for non-file pages
  
  // Always show toolbar on Drive
  ensureToolbar();
  
  // Load saved rotation state
  await loadRotationState();
  
  // Start looking for media immediately and continuously
  const assignTarget = debounce(() => {
    initAttempts++;
    log(`Searching for media element (attempt ${initAttempts})`);
    
    const el = findLargestMediaElement();
    if (el && el !== currentTarget) {
      log("Found new media element, setting as target");
      setTarget(el);
      updateToolbarStatus("Media found - Ready to rotate!");
    } else if (!el) {
      if (initAttempts <= 3) {
        updateToolbarStatus(`Searching for media... (${initAttempts})`);
        setTimeout(assignTarget, 1000); // Keep trying
      } else {
        updateToolbarStatus("No media found - click on image/video");
      }
    }
  }, 300);

  // Start searching
  assignTarget();

  // Watch for DOM changes continuously
  const mo = new MutationObserver(() => {
    assignTarget();
  });
  
  mo.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'style', 'class', 'data-testid']
  });

  // Also re-run on window resize
  window.addEventListener("resize", assignTarget);
  
  log("Drive initialization complete - watching for media");
}

// Wait for DOM to be ready, then initialize
function init() {
  log("Extension loaded");
  log(`Current URL: ${location.href}`);
  
  if (isDriveUrl()) {
    log("On Google Drive, initializing...");
    setTimeout(initOnDrive, 500); // Small delay for Drive to load
  } else {
    log("Not on Google Drive");
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
