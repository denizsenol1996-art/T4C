/* ═══════════════════════════════════════
   CarDatax Mobile — Kenteken Scanner
   ═══════════════════════════════════════ */
// ═══ PLATE SCANNER v3 — Yellow detect + Multi-threshold + RDW validation ═══
let scanStream = null;
let scannedPlate = '';
let _scanBusy = false;
let _torchOn = false;
let _plateDetectedFrames = 0;
let _lastDetectTime = 0;
let _lastPlateRect = null;
let _missFrames = 0;

async function startScanCam() {
  const video = document.getElementById('scanVideo');
  const status = document.getElementById('scan-status');
  const hint = document.getElementById('scanHint');
  document.getElementById('scan-result').style.display = 'none';
  _scanBusy = false;
  _plateDetectedFrames = 0;
  _lastPlateRect = null;
  _missFrames = 0;
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 },
        focusMode: { ideal: 'continuous' } }
    });
    video.srcObject = scanStream;
    status.textContent = 'Richt camera op kenteken';
    hint.textContent = 'Richt op kenteken';
    const track = scanStream.getVideoTracks()[0];
    if (track?.getCapabilities?.()?.torch) {
      document.getElementById('torchBtn').style.display = 'block';
    }
    if(window._scanInterval) clearInterval(window._scanInterval);
    window._scanInterval = setInterval(()=>{ if(scanStream && !_scanBusy) detectPlateFrame(); }, 300);
  } catch (e) {
    status.textContent = 'Camera niet beschikbaar: ' + e.message;
  }
}

// Fast client-side detection — sticky: tolerates missed frames
function detectPlateFrame() {
  const video = document.getElementById('scanVideo');
  const canvas = document.getElementById('scanCanvas');
  const viewport = document.querySelector('.scan-viewport');
  const hint = document.getElementById('scanHint');
  if(!video.videoWidth) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  const rect = findYellowPlate(ctx, canvas.width, canvas.height);
  if (rect) {
    _lastPlateRect = rect;
    _missFrames = 0;
    viewport?.classList.add('scan-detected');
    _plateDetectedFrames++;
    hint.textContent = _plateDetectedFrames >= 2 ? 'Even stilhouden...' : 'Plaat gevonden...';
    if (_plateDetectedFrames >= 2 && !_scanBusy) {
      _plateDetectedFrames = 0;
      captureAndScan(true);
    }
  } else {
    _missFrames++;
    // Sticky: tolerate up to 6 missed frames (~1.8s) before giving up
    if (_missFrames <= 6 && _lastPlateRect) {
      viewport?.classList.add('scan-detected');
      hint.textContent = 'Houd stil...';
      // Keep counting if we already had detections
      if (_plateDetectedFrames >= 1) {
        _plateDetectedFrames++;
        if (_plateDetectedFrames >= 3 && !_scanBusy) {
          _plateDetectedFrames = 0;
          captureAndScan(true);
        }
      }
    } else {
      viewport?.classList.remove('scan-detected');
      _plateDetectedFrames = 0;
      _lastPlateRect = null;
      _missFrames = 0;
      hint.textContent = 'Richt op kenteken';
    }
  }
}

function stopCam() {
  if(window._scanInterval){clearInterval(window._scanInterval);window._scanInterval=null}
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  _torchOn = false;
  _plateDetectedFrames = 0;
  _lastPlateRect = null;
  _missFrames = 0;
  const tb = document.getElementById('torchBtn');
  if(tb) tb.style.display = 'none';
}

function usePlate() {
  if (!scannedPlate) return;
  document.getElementById('mp').value = scannedPlate;
  document.getElementById('mp').dispatchEvent(new Event('input'));
  stopCam();
  go('taxatie');
}

function retryScan() {
  scannedPlate = '';
  document.getElementById('scan-result').style.display = 'none';
  document.getElementById('scan-status').textContent = 'Richt camera op kenteken';
  document.getElementById('scanHint').textContent = 'Richt op kenteken';
  _scanBusy = false;
  _plateDetectedFrames = 0;
  _lastPlateRect = null;
  _missFrames = 0;
  if(window._scanInterval) clearInterval(window._scanInterval);
  window._scanInterval = setInterval(()=>{ if(scanStream && !_scanBusy) detectPlateFrame(); }, 300);
}

async function toggleTorch() {
  if (!scanStream) return;
  const track = scanStream.getVideoTracks()[0];
  if (!track) return;
  _torchOn = !_torchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: _torchOn }] });
    const tb = document.getElementById('torchBtn');
    tb.style.borderColor = _torchOn ? 'var(--green)' : 'var(--border)';
    tb.style.color = _torchOn ? 'var(--green)' : 'var(--text3)';
  } catch(e) { _torchOn = false; }
}

// -- Yellow plate detection (forgiving) --
function findYellowPlate(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const cols = new Uint16Array(w);
  const rows = new Uint16Array(h);
  let totalYellow = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = d[i], g = d[i+1], b = d[i+2];
      // Relaxed: also catch darker/lighter yellows, reflections
      if (r > 120 && g > 100 && b < 170 && (r - b) > 40 && (r + g) > (b * 3)) {
        cols[x]++; rows[y]++; totalYellow++;
      }
    }
  }
  if (totalYellow < (w * h * 0.002)) return null;
  const colThresh = Math.max(2, h * 0.01);
  const rowThresh = Math.max(2, w * 0.01);
  let x1 = w, x2 = 0, y1 = h, y2 = 0;
  for (let x = 0; x < w; x++) { if (cols[x] > colThresh) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); } }
  for (let y = 0; y < h; y++) { if (rows[y] > rowThresh) { y1 = Math.min(y1, y); y2 = Math.max(y2, y); } }
  if (x2 <= x1 || y2 <= y1) return null;
  const pw = x2 - x1, ph = y2 - y1;
  const ratio = pw / Math.max(ph, 1);
  if (ratio < 1.5 || ratio > 10 || pw < 30 || ph < 8) return null;
  const mx = Math.round(pw * 0.08), my = Math.round(ph * 0.2);
  return { x: Math.max(0, x1 - mx), y: Math.max(0, y1 - my), w: Math.min(w - x1 + mx, pw + mx*2), h: Math.min(h - y1 + my, ph + my*2) };
}


// ── CAPTURE & SCAN (server-side OCR) ──
async function captureAndScan(auto) {
  if (_scanBusy) return;
  _scanBusy = true;
  const video = document.getElementById('scanVideo');
  const canvas = document.getElementById('scanCanvas');
  const status = document.getElementById('scan-status');
  const hint = document.getElementById('scanHint');
  const viewport = document.querySelector('.scan-viewport');
  if(!video.videoWidth) { _scanBusy = false; return; }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  // Find yellow plate region — or use last known position
  let cropRect = findYellowPlate(ctx, canvas.width, canvas.height);
  if (!cropRect && _lastPlateRect) {
    // Use last known position (hand moved slightly)
    cropRect = _lastPlateRect;
  }
  if (!cropRect) {
    hint.textContent = 'Richt op kenteken';
    _scanBusy = false; return;
  }

  // Show loading state immediately
  hint.textContent = 'Herkennen...';
  status.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;color:var(--green);font-weight:600"><span class="scan-spin"></span> Kenteken wordt gelezen...</span>';

  // Crop plate region with generous padding for Vision API
  const pad = Math.round(Math.max(cropRect.w, cropRect.h) * 0.15);
  const cx = Math.max(0, cropRect.x - pad);
  const cy = Math.max(0, cropRect.y - pad);
  const cw = Math.min(canvas.width - cx, cropRect.w + pad * 2);
  const ch = Math.min(canvas.height - cy, cropRect.h + pad * 2);
  const cropCanvas = document.createElement('canvas');
  const scale = Math.max(1, Math.ceil(400 / cw));
  cropCanvas.width = cw * scale; cropCanvas.height = ch * scale;
  const cropCtx = cropCanvas.getContext('2d');
  cropCtx.imageSmoothingEnabled = true;
  cropCtx.imageSmoothingQuality = 'high';
  cropCtx.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw * scale, ch * scale);

  // Send to server — JPEG is ~5x smaller than PNG = faster upload
  const base64 = cropCanvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  const t0 = Date.now();

  try {
    const r = await fetch('/api/plate/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64 })
    });
    const d = await r.json();
    const ms = Date.now() - t0;

    if (d.ok && d.plate) {
      scannedPlate = d.plate;
      if(window._scanInterval){clearInterval(window._scanInterval);window._scanInterval=null}
      if(navigator.vibrate) navigator.vibrate([50, 30, 50]);
      try { const ac=new AudioContext();const o=ac.createOscillator();const g=ac.createGain();
        o.connect(g);g.connect(ac.destination);o.frequency.value=880;g.gain.value=0.1;
        o.start();o.stop(ac.currentTime+0.1); } catch(e){}

      status.innerHTML = '<span style="color:var(--green);font-weight:700">\u2713 ' + d.make + ' ' + d.model + '</span> <span style="color:var(--text3);font-size:11px">' + (ms/1000).toFixed(1) + 's</span>';
      hint.textContent = fmtP(d.plate);
      viewport?.classList.remove('scan-detected');
      setTimeout(() => usePlate(), 600);
    } else if (d.plate) {
      scannedPlate = d.plate;
      if(window._scanInterval){clearInterval(window._scanInterval);window._scanInterval=null}
      document.getElementById('scanPlateText').textContent = fmtP(d.plate);
      document.getElementById('scan-result').style.display = 'block';
      const rdwInfo = document.getElementById('scanRdwInfo');
      if (rdwInfo) { rdwInfo.textContent = '\u26A0 Niet geverifieerd \u2014 controleer'; rdwInfo.style.color = '#f59e0b'; }
      status.textContent = d.error || 'Niet gevonden in RDW';
      hint.textContent = '';
      viewport?.classList.remove('scan-detected');
      _scanBusy = false;
    } else {
      status.textContent = d.error || 'Niet herkend \u2014 probeer opnieuw';
      hint.textContent = 'Richt op kenteken';
      _scanBusy = false;
      _plateDetectedFrames = 0;
    }
  } catch (e) {
    status.textContent = 'Fout: ' + e.message;
    _scanBusy = false;
    _plateDetectedFrames = 0;
  }
}


