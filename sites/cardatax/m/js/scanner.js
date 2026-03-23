// CarDatax Scanner — camera, guided scan, AI analyse, 3D viewer


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


// ═══ WALK-AROUND 360° INSPECTIE ═══

// ── State ──
let waStream = null, waAnimFrame = null, waTFModel = null
let waFrames = [], waCurrentAngle = 0, waOrientBase = null
let waOrientActive = false, waCapturing = false
let waStartTime = null, aiScanResult = null, damages = []
let waAudioCtx = null, waAudioStream = null, waAudioAnalyser = null
let waAudioActive = false, waAudioInterval = null

const WA_ZONES = [
  { name:'VOORKANT',     angle:0,   x:200, y:130,  label:'Voor' },
  { name:'RECHTS-VOOR',  angle:45,  x:310, y:190,  label:'RF' },
  { name:'RECHTS',       angle:90,  x:340, y:350,  label:'Rechts' },
  { name:'RECHTS-ACHTER',angle:135, x:310, y:510,  label:'RA' },
  { name:'ACHTERKANT',   angle:180, x:200, y:570,  label:'Achter' },
  { name:'LINKS-ACHTER', angle:225, x:90,  y:510,  label:'LA' },
  { name:'LINKS',        angle:270, x:60,  y:350,  label:'Links' },
  { name:'LINKS-VOOR',   angle:315, x:90,  y:190,  label:'LV' },
]
let waCapturedZones = new Set()

// ── Audio Engine (PS5-style) ──
function initAudioCtx() {
  if (!waAudioCtx) waAudioCtx = new (window.AudioContext || window.webkitAudioContext)()
}

function playSoftTone(freq, dur, vol) {
  try {
    initAudioCtx()
    const osc = waAudioCtx.createOscillator()
    const gain = waAudioCtx.createGain()
    osc.type = "sine"; osc.frequency.value = freq || 440
    const t = waAudioCtx.currentTime
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(vol || 0.06, t + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.001, t + (dur || 0.3))
    osc.connect(gain); gain.connect(waAudioCtx.destination)
    osc.start(t); osc.stop(t + (dur || 0.3))
  } catch(e) {}
}

function playBeep(freq, dur, vol) { playSoftTone(freq, dur, vol) }
function playScanTick() { playSoftTone(340, 0.5, 0.03) }
function playZoneCapture() {
  playSoftTone(660, 0.3, 0.08)
  setTimeout(function(){ playSoftTone(880, 0.4, 0.07) }, 200)
}
function playScanComplete() {
  [523,659,784,1047].forEach(function(f,i){ setTimeout(function(){ playSoftTone(f, 0.5, 0.08) }, i*180) })
}
function playScanStart() { playSoftTone(440, 0.5, 0.07) }
function playError() { playSoftTone(180, 0.6, 0.07) }

// ── Show section helper ──
function showWaSection(id) {
  ['wa-start','wa-camera','wa-analyzing','wa-map'].forEach(s => {
    const el = document.getElementById(s)
    if (el) el.style.display = s === id ? (id === 'wa-camera' ? 'block' : 'flex') : 'none'
  })
  if (id === 'wa-map') document.getElementById('wa-map').style.display = 'block'
}

// ── Start ──
async function startWalkaround() {
  const plate = document.getElementById('wa-plate')?.value?.trim()
  if (!plate) { toast('Vul kenteken in', 'warning'); return }
  
  playScanStart()
  waFrames = []; waCapturedZones = new Set(); waStartTime = Date.now()
  
  // Build zone dots
  const dots = document.getElementById('wa-zone-dots')
  if (dots) dots.innerHTML = WA_ZONES.map((z,i) =>
    `<div id="wdot-${i}" title="${z.name}" style="width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.2);transition:all .3s;flex-shrink:0"></div>`
  ).join('')
  
  showWaSection('wa-camera')
  
  try {
    waStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:'environment', width:{ideal:1920}, height:{ideal:1080} },
      audio: false
    })
    const video = document.getElementById('waVideo')
    video.srcObject = waStream
    video.onloadedmetadata = () => {
      startARCanvas()
      startOrientationTracking()
    currentScanStep = 0
    updateGuideUI()

// ═══ LANDSCAPE ROTATION SUPPORT ═══
function handleOrientation() {
  const cam = document.getElementById('wa-camera')
  if (!cam || cam.style.display === 'none') return
  // Allow both portrait and landscape — adjust canvas
  const canvas = document.getElementById('wa-ar-canvas')
  if (canvas) {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }
}
window.addEventListener('resize', handleOrientation)
window.addEventListener('orientationchange', () => setTimeout(handleOrientation, 200))

// ═══ PINCH TO ZOOM ═══
let currentZoom = 1, startDist = 0
const waVideoEl = document.getElementById('waVideo')

document.getElementById('wa-camera')?.addEventListener('touchstart', function(e) {
  if (e.touches.length === 2) {
    startDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
  }
}, { passive: true })

document.getElementById('wa-camera')?.addEventListener('touchmove', function(e) {
  if (e.touches.length === 2 && startDist > 0) {
    const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
    const scale = dist / startDist
    currentZoom = Math.max(1, Math.min(5, currentZoom * (1 + (scale - 1) * 0.05)))
    if (waVideoEl) waVideoEl.style.transform = 'scale(' + currentZoom + ')'
    startDist = dist
  }
}, { passive: true })

document.getElementById('wa-camera')?.addEventListener('touchend', function(e) {
  if (e.touches.length < 2) startDist = 0
}, { passive: true })

    }
  } catch(e) {
    playError()
    toast('Camera toegang geweigerd', 'error')
    showWaSection('wa-start')
  }
}

// ── AR Canvas — PS5 grid ──
function startARCanvas() {
  const canvas = document.getElementById('wa-ar-canvas')
  const video = document.getElementById('waVideo')
  if (!canvas || !video) return
  
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  const ctx = canvas.getContext('2d')
  
  let carBox = null, prevBox = null, frameCount = 0
  let arPhase = 'loading'
  let meshVerts = [] // persistent mesh vertices
  let scanBeamY = 0
  
  // Load TF model
  loadTFModel().then(m => {
    waTFModel = m
    arPhase = 'scanning'
    document.getElementById('wa-scan-status').textContent = 'Zoekt auto...'
  }).catch(() => {
    arPhase = 'scanning'
    document.getElementById('wa-scan-status').textContent = 'Handmatige modus'
  })
  
  // Smooth lerp
  function lerp(a, b, t) { return a + (b - a) * t }
  
  // Generate wireframe mesh vertices for car shape
  function buildMesh(bx, by, bw, bh) {
    const verts = []
    const cols = 20, rows = 14
    const cw = bw / cols, ch = bh / rows
    
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        // Base position
        let x = bx + c * cw
        let y = by + r * ch
        
        // Add car-like shape distortion: narrower at top (cabin), wider at bottom (body)
        const yPct = r / rows // 0=top, 1=bottom
        const xPct = c / cols // 0=left, 1=right
        const centerX = bx + bw / 2
        
        // Narrow the top 30% (cabin area)
        if (yPct < 0.35) {
          const narrow = 0.15 * (1 - yPct / 0.35)
          x = centerX + (x - centerX) * (1 - narrow)
        }
        
        // Slight curve at bottom (wheel arches)
        if (yPct > 0.8 && (xPct < 0.25 || xPct > 0.75)) {
          y -= (yPct - 0.8) * bh * 0.08
        }
        
        // Add subtle organic jitter (fixed per vertex, not random each frame)
        const jx = Math.sin(r * 7.3 + c * 11.1) * cw * 0.08
        const jy = Math.cos(r * 5.7 + c * 13.3) * ch * 0.08
        
        verts.push({ x: x + jx, y: y + jy, r, c })
      }
    }
    return { verts, cols, rows }
  }
  
  let detectCounter = 0
  let smoothBox = null
  
  function draw() {
    waAnimFrame = requestAnimationFrame(draw)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const W = canvas.width, H = canvas.height
    frameCount++
    scanBeamY += 2
    
    // Detection every 10 frames
    detectCounter++
    if (detectCounter >= 10 && waTFModel && video.readyState >= 2 && arPhase !== 'loading') {
      detectCounter = 0
      waTFModel.detect(video).then(preds => {
        const car = preds.find(p => p.class === 'car' && p.score > 0.65)
        if (car) {
          const sx = W / (video.videoWidth || 640)
          const sy = H / (video.videoHeight || 480)
          carBox = { x: car.bbox[0]*sx, y: car.bbox[1]*sy, w: car.bbox[2]*sx, h: car.bbox[3]*sy, score: car.score }
          if (arPhase === 'scanning') arPhase = 'found'
          document.getElementById('wa-scan-status').textContent = 'Auto gedetecteerd (' + Math.round(car.score*100) + '%)'
        } else {
          carBox = null
          if (arPhase === 'found') {
            document.getElementById('wa-scan-status').textContent = 'Zoekt auto...'
          }
        }
      }).catch(() => {})
    }
    
    // Smooth the box
    if (carBox) {
      if (!smoothBox) smoothBox = { ...carBox }
      else {
        smoothBox.x = lerp(smoothBox.x, carBox.x, 0.15)
        smoothBox.y = lerp(smoothBox.y, carBox.y, 0.15)
        smoothBox.w = lerp(smoothBox.w, carBox.w, 0.15)
        smoothBox.h = lerp(smoothBox.h, carBox.h, 0.15)
        smoothBox.score = carBox.score
      }
    }
    
    const box = smoothBox || carBox
    const scanPct = Math.min(1, waFrames.length / 8)
    const col = scanPct >= 1 ? [0, 255, 156] : [0, 140, 255] // green when done, teal while scanning
    
    if (box && arPhase !== 'loading') {
      const mesh = buildMesh(box.x, box.y, box.w, box.h)
      const { verts, cols, rows } = mesh
      const time = frameCount * 0.015
      
      // ═══ DRAW WIREFRAME MESH ═══
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * (cols + 1) + c
          const tl = verts[i], tr = verts[i + 1]
          const bl = verts[i + cols + 1], br = verts[i + cols + 2]
          if (!tl || !tr || !bl || !br) continue
          
          // Distance from scan beam for highlight effect
          const cellY = (tl.y + bl.y) / 2
          const beamDist = Math.abs(cellY - (box.y + (scanBeamY % box.h)))
          const beamGlow = Math.max(0, 1 - beamDist / (box.h * 0.15))
          
          // Animated alpha per cell
          const wave = Math.sin(time + r * 0.3 + c * 0.2) * 0.15 + 0.85
          const baseAlpha = (0.35 + scanPct * 0.2 + beamGlow * 0.4) * wave
          
          // Triangle 1: TL-TR-BL
          ctx.beginPath()
          ctx.moveTo(tl.x, tl.y)
          ctx.lineTo(tr.x, tr.y)
          ctx.lineTo(bl.x, bl.y)
          ctx.closePath()
          ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${baseAlpha * 0.08})`
          ctx.fill()
          ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${Math.min(1, baseAlpha * 1.2 + beamGlow * 0.5)})`
          ctx.lineWidth = beamGlow > 0.3 ? 2.2 : 1.2
          ctx.stroke()
          
          // Triangle 2: TR-BR-BL
          ctx.beginPath()
          ctx.moveTo(tr.x, tr.y)
          ctx.lineTo(br.x, br.y)
          ctx.lineTo(bl.x, bl.y)
          ctx.closePath()
          ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${baseAlpha * 0.1})`
          ctx.fill()
          ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${baseAlpha * 0.9 + beamGlow * 0.4})`
          ctx.lineWidth = beamGlow > 0.3 ? 2.2 : 1.2
          ctx.stroke()
        }
      }
      
      // ═══ SCAN BEAM ═══
      const beamAbsY = box.y + (scanBeamY % box.h)
      ctx.beginPath()
      ctx.moveTo(box.x - 10, beamAbsY)
      ctx.lineTo(box.x + box.w + 10, beamAbsY)
      const beamGrad = ctx.createLinearGradient(box.x, beamAbsY, box.x + box.w, beamAbsY)
      beamGrad.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`)
      beamGrad.addColorStop(0.2, `rgba(${col[0]},${col[1]},${col[2]},0.8)`)
      beamGrad.addColorStop(0.8, `rgba(${col[0]},${col[1]},${col[2]},0.8)`)
      beamGrad.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`)
      ctx.strokeStyle = beamGrad
      ctx.lineWidth = 4
      ctx.shadowColor = `rgba(${col[0]},${col[1]},${col[2]},1)`
      ctx.shadowBlur = 30
      ctx.stroke()
      ctx.shadowBlur = 0
      
      // ═══ CORNER BRACKETS with glow ═══
      const bx = box.x, by = box.y, bw = box.w, bh = box.h
      const brL = Math.min(35, bw * 0.12)
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.85)`
      ctx.lineWidth = 3.5
      ctx.shadowColor = `rgba(${col[0]},${col[1]},${col[2]},1)`
      ctx.shadowBlur = 25
      ctx.beginPath(); ctx.moveTo(bx, by+brL); ctx.lineTo(bx, by); ctx.lineTo(bx+brL, by); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(bx+bw-brL, by); ctx.lineTo(bx+bw, by); ctx.lineTo(bx+bw, by+brL); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(bx, bh+by-brL); ctx.lineTo(bx, by+bh); ctx.lineTo(bx+brL, by+bh); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(bx+bw-brL, by+bh); ctx.lineTo(bx+bw, by+bh); ctx.lineTo(bx+bw, by+bh-brL); ctx.stroke()
      ctx.shadowBlur = 0
      
      // ═══ SCANNING HUD BADGE ═══
      const scanPercent = Math.round(scanPct * 100)
      const badgeW = 160, badgeH = 30
      const badgeX = bx + bw/2 - badgeW/2, badgeY = by - 40
      
      // Badge background
      ctx.fillStyle = 'rgba(0,8,20,0.88)'
      ctx.shadowColor = `rgba(${col[0]},${col[1]},${col[2]},0.3)`
      ctx.shadowBlur = 10
      ctx.beginPath(); ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 8); ctx.fill()
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.3)`
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 8); ctx.stroke()
      ctx.shadowBlur = 0
      
      // SCANNING text
      ctx.font = '700 11px -apple-system, sans-serif'
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.8)`
      ctx.fillText('SCANNING', badgeX + 12, badgeY + 20)
      
      // Percentage
      ctx.font = '900 14px -apple-system, sans-serif'
      ctx.fillStyle = scanPercent >= 100 ? '#00FF9C' : '#fff'
      ctx.fillText(scanPercent + '%', badgeX + 88, badgeY + 20)
      
      // Mini progress bar
      const pbX = badgeX + 125, pbY = badgeY + 10, pbW = 28, pbH = 10
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.beginPath(); ctx.roundRect(pbX, pbY, pbW, pbH, 4); ctx.fill()
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.8)`
      ctx.beginPath(); ctx.roundRect(pbX, pbY, Math.max(2, pbW * scanPct), pbH, 4); ctx.fill()
      
      // ═══ EDGE GLOW — outer frame subtle border ═══
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.04)`
      ctx.lineWidth = 1
      ctx.strokeRect(20, 20, W-40, H-40)
      
      // ═══ TICK MARKS along edges ═══
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.15)`
      ctx.lineWidth = 0.5
      for (let i = 0; i < 8; i++) {
        const tx = bx + (bw / 8) * i
        ctx.beginPath(); ctx.moveTo(tx, by - 4); ctx.lineTo(tx, by + 4); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(tx, by + bh - 4); ctx.lineTo(tx, by + bh + 4); ctx.stroke()
      }
      
      // ═══ SILENT AUTO-CAPTURE ═══
      if (carBox && waOrientActive && !waCapturing && arPhase !== 'loading') {
        const zone = WA_ZONES.reduce((best, z) => {
          const diff = Math.abs(((waCurrentAngle - z.angle + 540) % 360) - 180)
          const bestDiff = Math.abs(((waCurrentAngle - best.angle + 540) % 360) - 180)
          return diff < bestDiff ? z : best
        })
        const diff = Math.abs(((waCurrentAngle - zone.angle + 540) % 360) - 180)
        if (diff < 18 && !waCapturedZones.has(zone.angle)) {
          captureFrame(zone)
        }
      }
      
    } else if (arPhase === 'scanning') {
      // ═══ SEARCHING ANIMATION ═══
      const cx = W/2, cy = H/2
      // Rotating arcs
      for (let i = 0; i < 4; i++) {
        ctx.strokeStyle = `rgba(0,180,220,${0.08 + i * 0.02})`
        ctx.lineWidth = 1.5
        const r = 30 + i * 20
        const a = frameCount * 0.015 + i * 1.5
        ctx.beginPath()
        ctx.arc(cx, cy, r, a, a + Math.PI * 0.6)
        ctx.stroke()
      }
      // Crosshair
      ctx.strokeStyle = 'rgba(0,220,180,0.12)'
      ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(cx-50, cy); ctx.lineTo(cx+50, cy); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx, cy-50); ctx.lineTo(cx, cy+50); ctx.stroke()
      

      // ═══ AUTO-GUIDED CAPTURE ═══
      // When car detected + at right angle → auto capture
      if (carBox && !guidedValidating && currentScanStep < 8) {
        const step = SCAN_STEPS[currentScanStep]
        if (step && waOrientActive) {
          const diff = Math.abs(((waCurrentAngle - step.angle + 540) % 360) - 180)
          if (diff < 20) {
            // At the right angle with car in view → auto capture after 1s
            if (!window._autoCapTimer) {
              showAIFeedback('Auto herkend — vastleggen in 1s...', '#00FF9C')
              window._autoCapTimer = setTimeout(() => {
                window._autoCapTimer = null
                if (!guidedValidating && currentScanStep < 8) guidedCapture()
              }, 1000)
            }
          } else {
            // Wrong angle — clear timer
            if (window._autoCapTimer) { clearTimeout(window._autoCapTimer); window._autoCapTimer = null; hideAIFeedback() }
          }
        }
      }
      
        } else if (arPhase === 'loading') {
      // ═══ LOADING SPINNER ═══
      ctx.save()
      ctx.strokeStyle = '#00FF9C'
      ctx.lineWidth = 2.5
      ctx.shadowColor = '#00FF9C'
      ctx.shadowBlur = 12
      ctx.translate(W/2, H/2)
      ctx.rotate(frameCount * 0.04)
      ctx.beginPath()
      ctx.arc(0, 0, 28, 0, Math.PI * 1.5)
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.restore()
    }
  }
  
  draw()
}

async function loadTFModel() {
  if (waTFModel) return waTFModel
  await tf.ready()
  return await cocoSsd.load({ base:'lite_mobilenet_v2' })
}

async function detectCarInFrame(video, W, H) {
  try {
    const preds = await waTFModel.detect(video)
    const car = preds.find(p =>
      ['car'].includes(p.class) && p.score > 0.65
    )
    if (!car) {
      updateScanHints(null, W, H, video)
      return null
    }
    const [x,y,w,h] = car.bbox
    const scaleX = W / video.videoWidth
    const scaleY = H / video.videoHeight
    const box = { x:x*scaleX, y:y*scaleY, w:w*scaleX, h:h*scaleY, score: car.score }
    updateScanHints(box, W, H, video)
    return box
  } catch(e) { return null }
}

function updateScanHints(box, W, H, video) {
  const status = document.getElementById('wa-scan-status')
  if (!status) return

  // Brightness check
  try {
    const tc = document.createElement('canvas')
    tc.width = 64; tc.height = 48
    tc.getContext('2d').drawImage(video, 0, 0, 64, 48)
    const px = tc.getContext('2d').getImageData(0,0,64,48).data
    let sum = 0
    for (let i=0; i<px.length; i+=16) sum += (px[i]+px[i+1]+px[i+2])/3
    const brightness = sum / (px.length/16)
    if (brightness < 40) {
      status.textContent = 'Te donker — meer licht nodig'
      status.style.color = '#ef4444'
      return
    }
    if (brightness > 240) {
      status.textContent = 'Te veel licht / tegenlicht'
      status.style.color = '#f59e0b'
      return
    }
  } catch(e) {}

  if (!box) {
    status.textContent = 'Zoekt auto...'
    status.style.color = 'rgba(255,255,255,.6)'
    return
  }

  // Distance check: car should fill 25-85% of frame
  const carArea = (box.w * box.h) / (W * H)
  if (carArea < 0.08) {
    status.textContent = 'Te ver weg — loop dichterbij'
    status.style.color = '#f59e0b'
  } else if (carArea > 0.85) {
    status.textContent = 'Te dichtbij — loop iets terug'
    status.style.color = '#f59e0b'
  } else {
    status.textContent = 'Auto gedetecteerd (' + Math.round(box.score*100) + '%)'
    status.style.color = '#00FF9C'
  }
}

// ── Orientation tracking ──
function startOrientationTracking() {
  if (waOrientActive) return
  
  const request = () => {
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(r => { if (r === 'granted') initOrientation() })
        .catch(() => {})
    } else {
      initOrientation()
    }
  }
  
  request()
  const btn = document.getElementById('wa-gyro-btn')
  if (btn) { btn.style.borderColor='#00FF9C'; btn.style.color='#00FF9C' }
}

function initOrientation() {
  waOrientActive = true
  waOrientBase = null
  window.addEventListener('deviceorientation', handleOrientation)
}

function stopOrientationTracking() {
  waOrientActive = false
  waOrientBase = null
  window.removeEventListener('deviceorientation', handleOrientation)
}

let waCountdownTimer = null, waCountdownActive = false

function handleOrientation(e) {
  if (!waOrientActive || !e.alpha) return
  
  const alpha = e.alpha
  if (waOrientBase === null) { waOrientBase = alpha; return }
  
  let rel = ((alpha - waOrientBase) + 360) % 360
  waCurrentAngle = rel
  
  // Find nearest zone
  const zone = WA_ZONES.reduce((best, z) => {
    const diff = Math.abs(((rel - z.angle + 540) % 360) - 180)
    const bestDiff = Math.abs(((rel - best.angle + 540) % 360) - 180)
    return diff < bestDiff ? z : best
  })
  
  const diff = Math.abs(((rel - zone.angle + 540) % 360) - 180)
  
  // Update angle label
  const lbl = document.getElementById('wa-angle-label')
  if (lbl) lbl.textContent = zone.name + ' (' + Math.round(rel) + '°)'
  
  if (diff < 15 && carBox && !waCapturedZones.has(zone.angle) && !waCountdownActive) {
    showAutoCapCountdown(zone)
  } else if (diff >= 20 && waCountdownActive) {
    clearAutoCountdown()
  }
}

function showAutoCapCountdown(zone) {
  // Silent auto-capture — no visual countdown
  waCountdownActive = true
  setTimeout(() => {
    clearAutoCountdown()
    captureFrame(zone)
  }, 300)
}

function clearAutoCountdown() {
  waCountdownActive = false
  clearInterval(waCountdownTimer)
  const ring = document.getElementById('wa-center-ring')
  if (ring) ring.style.display = 'none'
}

// ── Capture Frame ──

// ═══ GUIDED SCAN FLOW ═══
const SCAN_STEPS = [
  { name: 'VOORKANT', icon: '🚗', hint: 'Zorg dat de hele voorkant zichtbaar is', angle: 0 },
  { name: 'RECHTS-VOOR', icon: '↗️', hint: 'Schuin rechts voor de auto', angle: 45 },
  { name: 'RECHTS', icon: '➡️', hint: 'Rechterzijde volledig in beeld', angle: 90 },
  { name: 'RECHTS-ACHTER', icon: '↘️', hint: 'Schuin rechts achter de auto', angle: 135 },
  { name: 'ACHTERKANT', icon: '🔙', hint: 'Achterkant volledig in beeld', angle: 180 },
  { name: 'LINKS-ACHTER', icon: '↙️', hint: 'Schuin links achter de auto', angle: 225 },
  { name: 'LINKS', icon: '⬅️', hint: 'Linkerzijde volledig in beeld', angle: 270 },
  { name: 'LINKS-VOOR', icon: '↖️', hint: 'Schuin links voor de auto', angle: 315 },
]
let currentScanStep = 0
let guidedValidating = false

function updateGuideUI() {
  const step = SCAN_STEPS[currentScanStep]
  if (!step) return
  
  const label = document.getElementById('wa-angle-label')
  const status = document.getElementById('wa-scan-status')
  const guide = document.getElementById('wa-guide-text')
  const guideSub = document.getElementById('wa-guide-sub')
  const guideIcon = document.getElementById('wa-guide-icon')
  const counter = document.getElementById('wa-zone-counter')
  const photoCount = document.getElementById('wa-photo-count')
  
  if (label) label.textContent = step.name
  if (status) status.textContent = 'Stap ' + (currentScanStep + 1) + ' van 8'
  if (guide) guide.textContent = 'Fotografeer de ' + step.name
  if (guideSub) guideSub.textContent = step.hint
  if (guideIcon) guideIcon.textContent = step.icon
  if (counter) counter.textContent = currentScanStep + '/8'
  if (photoCount) photoCount.textContent = currentScanStep
  
  // Update dots
  const dots = document.getElementById('wa-zone-dots')
  if (dots) {
    dots.innerHTML = SCAN_STEPS.map((s, i) => {
      const done = i < currentScanStep
      const current = i === currentScanStep
      const bg = done ? '#00FF9C' : current ? 'rgba(0,255,156,.5)' : 'rgba(255,255,255,.2)'
      const shadow = done ? '0 0 6px #00FF9C' : 'none'
      return '<div style="width:' + (current ? '12' : '8') + 'px;height:' + (current ? '12' : '8') + 'px;border-radius:50%;background:' + bg + ';box-shadow:' + shadow + ';transition:all .3s" id="wdot-' + i + '"></div>'
    }).join('')
  }
}

async function guidedCapture() {
  if (guidedValidating) return
  const video = document.getElementById('waVideo')
  if (!video) return
  
  const step = SCAN_STEPS[currentScanStep]
  if (!step) return
  
  guidedValidating = true
  const btn = document.getElementById('wa-snap-btn')
  if (btn) { btn.style.borderColor = '#ffb340'; btn.style.boxShadow = '0 0 30px rgba(255,179,0,.3)' }
  
  showAIFeedback('Foto wordt gevalideerd door AI...', '#ffb340')
  
  // Capture the frame
  const snap = document.createElement('canvas')
  const vw = video.videoWidth || 640
  const vh = video.videoHeight || 480
  snap.width = vw; snap.height = vh
  snap.getContext('2d').drawImage(video, 0, 0, vw, vh)
  
  let dataUrl = ''
  try { dataUrl = snap.toDataURL('image/jpeg', 0.75) } catch(e) { dataUrl = snap.toDataURL('image/png') }
  
  if (!dataUrl || dataUrl.length < 1000) {
    showAIFeedback('Foto mislukt — probeer opnieuw', '#ff4444')
    guidedValidating = false
    resetCaptureBtn()
    return
  }
  
  // Quick AI validation
  let isValid = true
  let aiMsg = ''
  try {
    const token = _t4cToken()
    const resp = await fetch('/api/ai/validate-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ image: dataUrl, expected_angle: step.name, step: currentScanStep + 1 })
    })
    const d = await resp.json()
    if (d.ok && d.valid) {
      isValid = true
      aiMsg = d.message || 'Goedgekeurd!'
    } else if (d.ok && !d.valid) {
      isValid = false
      aiMsg = d.message || 'Geen auto gedetecteerd'
    } else {
      // API error - accept anyway
      isValid = true
      aiMsg = 'Geaccepteerd'
    }
  } catch(e) {
    // API not available — accept the photo
    isValid = true
    aiMsg = 'Vastgelegd'
  }
  
  if (isValid) {
    // Accept photo
    const frame = { zone: step.name, angle: step.angle, image: dataUrl, ts: Date.now() }
    waFrames.push(frame)
    waCapturedZones.add(step.angle)
    
    // Visual feedback
    showAIFeedback('✓ ' + step.name + ' — ' + aiMsg, '#00FF9C')
    try { playZoneCapture() } catch(e) {}
    
    // Flash effect
    try {
      const arCanvas = document.getElementById('wa-ar-canvas')
      if (arCanvas) {
        const ctx = arCanvas.getContext('2d')
        ctx.fillStyle = 'rgba(0,255,156,0.3)'
        ctx.fillRect(0, 0, arCanvas.width, arCanvas.height)
        setTimeout(() => ctx.clearRect(0, 0, arCanvas.width, arCanvas.height), 200)
      }
    } catch(e) {}
    
    // Add thumbnail
    try { addThumb({ name: step.name, angle: step.angle }, dataUrl) } catch(e) {}
    
    // Move to next step
    currentScanStep++
    
    if (currentScanStep >= 8) {
      // All done!
      showAIFeedback('Alle 8 posities vastgelegd! Analyse start...', '#00FF9C')
      if (btn) { btn.style.borderColor = '#00FF9C'; btn.style.boxShadow = '0 0 40px rgba(0,255,156,.4)' }
      document.getElementById('wa-bottom-status').textContent = 'SCAN COMPLEET — AI ANALYSE BEZIG...'
      try { playScanComplete() } catch(e) {}
      setTimeout(() => runAIDamageAnalysis(), 1500)
    } else {
      // Next step
      setTimeout(() => {
        updateGuideUI()
        resetCaptureBtn()
        hideAIFeedback()
      }, 1200)
    }
  } else {
    // Rejected
    showAIFeedback('✗ ' + aiMsg + ' — Probeer opnieuw', '#ff4444')
    if (btn) { btn.style.borderColor = '#ff4444'; btn.style.boxShadow = '0 0 30px rgba(255,68,68,.3)' }
    setTimeout(() => { resetCaptureBtn(); hideAIFeedback() }, 2000)
  }
  
  guidedValidating = false
}

function showAIFeedback(msg, color) {
  const el = document.getElementById('wa-ai-feedback')
  const inner = document.getElementById('wa-ai-feedback-inner')
  const text = document.getElementById('wa-ai-feedback-text')
  if (!el || !text) return
  text.textContent = msg
  text.style.color = color || '#fff'
  inner.style.borderColor = (color || 'rgba(255,255,255,.2)').replace(')', ',.3)').replace('rgb', 'rgba')
  el.style.display = 'block'
}

function hideAIFeedback() {
  const el = document.getElementById('wa-ai-feedback')
  if (el) el.style.display = 'none'
}

function resetCaptureBtn() {
  const btn = document.getElementById('wa-snap-btn')
  if (btn) { btn.style.borderColor = 'rgba(0,255,156,.6)'; btn.style.boxShadow = '0 0 30px rgba(0,255,156,.2)' }
}

// Override startWalkaround to init guided flow
const _origStartWalkaround = typeof startWalkaround === 'function' ? startWalkaround : null


function captureFrame(zone) {
  try {
    const video = document.getElementById('waVideo')
    if (!video) { console.error('[CAPTURE] No video element'); waCapturing = false; return }
    if (waCapturing) { console.log('[CAPTURE] Already capturing, skip'); return }
    waCapturing = true
    
    // Find current zone
    if (!zone) {
      zone = WA_ZONES.reduce((best, z) => {
        const diff = Math.abs(((waCurrentAngle - z.angle + 540) % 360) - 180)
        const bestDiff = Math.abs(((waCurrentAngle - best.angle + 540) % 360) - 180)
        return diff < bestDiff ? z : best
      })
    }
    
    // Capture snapshot
    const snap = document.createElement('canvas')
    const vw = video.videoWidth || video.clientWidth || 640
    const vh = video.videoHeight || video.clientHeight || 480
    snap.width = vw
    snap.height = vh
    const sctx = snap.getContext('2d')
    sctx.drawImage(video, 0, 0, vw, vh)
    
    let dataUrl = ''
    try { dataUrl = snap.toDataURL('image/jpeg', 0.7) } catch(e) { 
      console.error('[CAPTURE] toDataURL failed:', e)
      // Try png fallback
      try { dataUrl = snap.toDataURL('image/png') } catch(e2) { dataUrl = '' }
    }
    
    if (!dataUrl || dataUrl.length < 1000) {
      console.error('[CAPTURE] Empty image, length:', dataUrl?.length)
      toast('Foto vastleggen mislukt — probeer opnieuw', 'warning')
      waCapturing = false
      return
    }
    
    console.log('[CAPTURE] Photo captured:', zone.name, 'size:', dataUrl.length)
    
    // Add frame
    const frame = { zone: zone.name, angle: zone.angle, image: dataUrl, ts: Date.now() }
    const existing = waFrames.findIndex(f => f.angle === zone.angle)
    if (existing >= 0) waFrames[existing] = frame
    else waFrames.push(frame)
    
    waCapturedZones.add(zone.angle)
    
    // Sound
    try { playZoneCapture() } catch(e) {}
    
    // Flash effect
    try {
      const arCanvas = document.getElementById('wa-ar-canvas')
      if (arCanvas) {
        const ctx = arCanvas.getContext('2d')
        ctx.fillStyle = 'rgba(0,255,156,0.4)'
        ctx.fillRect(0, 0, arCanvas.width, arCanvas.height)
        setTimeout(() => ctx.clearRect(0, 0, arCanvas.width, arCanvas.height), 200)
      }
    } catch(e) {}
    
    // Update thumb
    try { addThumb(zone, dataUrl) } catch(e) { console.error('[CAPTURE] Thumb error:', e) }
    
    // Update zone dot
    const zoneIdx = WA_ZONES.findIndex(z => z.angle === zone.angle)
    const dot = document.getElementById('wdot-' + zoneIdx)
    if (dot) {
      dot.style.background = '#00FF9C'
      dot.style.borderColor = '#00FF9C'
      dot.style.boxShadow = '0 0 6px #00FF9C'
    }
    
    // Update counter
    const count = waCapturedZones.size
    const countEl = document.getElementById('wa-photo-count')
    if (countEl) countEl.textContent = count
    const counterEl = document.getElementById('wa-zone-counter')
    if (counterEl) counterEl.textContent = count + '/8'
    
    // Visual feedback on button
    const btn = document.getElementById('wa-snap-btn')
    if (btn) {
      btn.style.background = 'rgba(0,255,156,0.3)'
      btn.style.borderColor = '#00FF9C'
      setTimeout(() => { btn.style.background = 'rgba(255,255,255,.15)'; btn.style.borderColor = 'rgba(255,255,255,.4)' }, 300)
    }
    
    // Toast feedback
    toast(zone.name + ' vastgelegd (' + count + '/8)', 'success')
    
    // Enable analyze button at 4+
    if (count >= 4) {
      const aBtn = document.getElementById('wa-to-map-btn')
      if (aBtn) { aBtn.disabled = false; aBtn.style.opacity = '1' }
    }
    
    // Auto-trigger at 8
    if (count >= 8) {
      try { playScanComplete() } catch(e) {}
      setTimeout(() => runAIDamageAnalysis(), 1200)
    }
    
  } catch(e) {
    console.error('[CAPTURE] Fatal error:', e)
    toast('Fout bij vastleggen: ' + e.message, 'error')
  }
  
  // ALWAYS reset capturing flag
  setTimeout(() => { waCapturing = false }, 300)
}

function addThumb(zone, dataUrl) {
  const container = document.getElementById('wa-thumbs')
  if (!container) return
  
  const existing = document.getElementById('thumb-' + zone.angle)
  if (existing) { existing.querySelector('img').src = dataUrl; return }
  
  const div = document.createElement('div')
  div.id = 'thumb-' + zone.angle
  div.style.cssText = 'flex-shrink:0;position:relative;border-radius:8px;overflow:hidden;border:2px solid #00FF9C'
  div.innerHTML = `
    <img src="${dataUrl}" style="width:52px;height:40px;object-fit:cover;display:block">
    <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.7);font-size:8px;font-weight:700;color:#00FF9C;text-align:center;padding:2px">${zone.label||zone.name.split('-')[0]}</div>
  `
  container.appendChild(div)
}

// ── Stop camera ──
function stopInspCam() {
  if (waStream) { waStream.getTracks().forEach(t => t.stop()); waStream = null }
  if (waAnimFrame) { cancelAnimationFrame(waAnimFrame); waAnimFrame = null }
  stopOrientationTracking()
}

// ── AI Damage Analysis ──
async function runAIDamageAnalysis() {
  if (!waFrames || waFrames.length < 1) { toast('Minimaal 1 foto nodig (' + waFrames.length + '/4)', 'warning'); return }
  
  stopInspCam()
  
  // Show analyzing screen
  showWaSection('wa-analyzing')
  document.getElementById('wa-map').style.display = 'none'
  
  const setStep = (n, done=false) => {
    const el = document.getElementById('was'+n)
    if (el) {
      el.style.color = done ? 'var(--green)' : 'var(--text1)'
      el.querySelector('span').style.background = done ? 'var(--green)' : 'var(--text1)'
    }
    document.getElementById('wa-analyze-bar').style.width = (n*25) + '%'
    document.getElementById('wa-analyze-status').textContent = el?.textContent?.trim() || ''
  }
  
  setStep(1)
  
  // Compress images
  const compressed = await Promise.all(waFrames.map(async f => {
    const img = new Image()
    img.src = f.image
    await new Promise(r => { img.onload = r })
    const c = document.createElement('canvas')
    c.width = 800; c.height = Math.round(800 * img.height / img.width)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return { zone: f.zone, angle: f.angle, image: c.toDataURL('image/jpeg', 0.65) }
  }))
  
  setStep(1, true); setStep(2)
  
  try {
    const token = _t4cToken()
    const plate = document.getElementById('wa-plate')?.value?.trim()
    
    const resp = await fetch('/api/analyze-damage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer '+token },
      body: JSON.stringify({ kenteken: plate, frames: compressed })
    })
    
    setStep(2, true); setStep(3)
    
    const data = await resp.json()
    if (!data.success) throw new Error(data.error || 'Analyse mislukt')
    
    aiScanResult = data.result || {}
    damages = (data.result?.damages || data.damages || [])
    
    setStep(3, true); setStep(4)
    
    await new Promise(r => setTimeout(r, 600))
    setStep(4, true)
    
    await new Promise(r => setTimeout(r, 400))
    
    showDamageMap(aiScanResult)
    playScanComplete()
    
  } catch(e) {
    playError()
    toast('Analyse mislukt: ' + e.message, 'error')
    showWaSection('wa-camera')
    // Restart camera
    startWalkaround()
  }
}

// ── Show Damage Map ──
function showDamageMap(data) {
  if (!data) { data = {} }
  
  showWaSection('wa-map')
  
  // Scores
  const scores = document.getElementById('wa-scores')
  if (scores) {
    const items = [
      { label:'Conditie', val: data.overall_score||0, color:'var(--green)' },
      { label:'Lak', val: data.paint_score||0, color:'#3b82f6' },
      { label:'Carrosserie', val: data.body_score||0, color:'#f59e0b' },
    ]
    scores.innerHTML = items.map(s => `
      <div style="background:var(--bg2);border:1px solid var(--border-l);border-radius:12px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:${s.color}">${Math.round(s.val*10)/10}</div>
        <div style="font-size:10px;color:var(--text3);font-weight:600;margin-top:2px">${s.label}</div>
      </div>
    `).join('')
  }
  
  // Summary
  if (data.summary) {
    const box = document.getElementById('wa-ai-summary')
    const txt = document.getElementById('wa-ai-summary-text')
    if (box && txt) { box.style.display='block'; txt.textContent = data.summary }
  }
  
  // Damage markers on SVG
  renderAllMarkers()
  
  // Damage list
  renderDamageList()
  
  // 3D Wireframe Viewer
  setTimeout(() => {
    init3DViewer()
    if (damages.length) add3DDamageMarkers(damages)
  }, 500)
}

// ── Render markers on SVG ──
function renderAllMarkers() {
  const layer = document.getElementById('damageMarkers')
  if (!layer || !damages.length) return
  
  layer.innerHTML = damages.map((d, i) => {
    const zone = WA_ZONES.find(z => z.name === d.zone?.toUpperCase()) || WA_ZONES[0]
    const color = d.sev === 'licht' ? '#00FF9C' : d.sev === 'gemiddeld' ? '#ffc107' : '#ef4444'
    return `
      <g transform="translate(${zone.x},${zone.y})" style="cursor:pointer" onclick="showDamageDetail(${i})">
        <circle r="18" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="1.5">
          <animate attributeName="r" values="14;18;14" dur="2s" repeatCount="indefinite"/>
          <animate attributeName="stroke-opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/>
        </circle>
        <circle r="10" fill="${color}" fill-opacity="0.9"/>
        <text y="4" text-anchor="middle" fill="#000" font-size="10" font-weight="800">${i+1}</text>
      </g>
    `
  }).join('')
}

// ── Render damage list ──
function renderDamageList() {
  const list = document.getElementById('wa-damage-list')
  if (!list) return
  
  if (!damages.length) {
    list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);font-size:13px">Geen schade gedetecteerd</div>'
    const te = document.getElementById('wa-total-cost')
    if (te) te.textContent = '€ 0'
    return
  }
  
  const totalCost = damages.reduce((s, d) => s + (d.cost||0), 0)
  
  list.innerHTML = damages.map((d, i) => {
    const sc = d.sev==='licht' ? 'var(--green)' : d.sev==='gemiddeld' ? '#ffc107' : '#ef4444'
    const sb = d.sev==='licht' ? 'rgba(0,255,156,.08)' : d.sev==='gemiddeld' ? 'rgba(255,193,7,.08)' : 'rgba(239,68,68,.08)'
    return `<div onclick="showDamageDetail(${i})" style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--bg2);border-radius:12px;border:1px solid var(--border-l);margin-bottom:8px;cursor:pointer;active:opacity:.8">
      <div style="width:28px;height:28px;border-radius:8px;background:${sb};border:1px solid ${sc};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;font-weight:800;color:${sc}">${i+1}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--text1)">${d.zone||'Onbekend'}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.description||d.type||''}</div>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:${sb};color:${sc};display:inline-block;margin-top:3px">${d.sev||'onbekend'}</span>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:14px;font-weight:800;color:var(--text1)">€ ${(d.cost||0).toLocaleString('nl-NL')}</div>
        <div style="font-size:10px;color:var(--text3)">herstel</div>
      </div>
    </div>`
  }).join('')
  
  const te = document.getElementById('wa-total-cost')
  if (te) te.textContent = '€ ' + totalCost.toLocaleString('nl-NL')
}

function showDamageDetail(idx) {
  const d = damages[idx]
  if (!d) return
  const color = d.sev==='licht' ? 'var(--green)' : d.sev==='gemiddeld' ? '#ffc107' : '#ef4444'
  toast(`${d.zone}: ${d.description} · € ${(d.cost||0).toLocaleString('nl-NL')}`, 'info', 4000)
}



// ═══ THREE.JS 3D DAMAGE VIEWER ═══
let scene3d, camera3d, renderer3d, carModel3d, damageMarkers3d = []
let autoRotate3d = true, rotateSpeed3d = 0.005

function init3DViewer() {
  const container = document.getElementById('wa-3d-viewer')
  const canvas = document.getElementById('wa-3d-canvas')
  if (!container || !canvas || scene3d) return

  const w = container.clientWidth, h = container.clientHeight
  scene3d = new THREE.Scene()
  scene3d.background = new THREE.Color(0x080c14)
  scene3d.fog = new THREE.FogExp2(0x080c14, 0.06)

  camera3d = new THREE.PerspectiveCamera(40, w/h, 0.1, 100)
  camera3d.position.set(5, 3, 6)
  camera3d.lookAt(0, 0.5, 0)

  renderer3d = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer3d.setSize(w, h)
  renderer3d.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  // Lighting — subtle, let wireframe glow do the work
  scene3d.add(new THREE.AmbientLight(0x112233, 0.4))
  const dir = new THREE.DirectionalLight(0xffffff, 0.3)
  dir.position.set(5, 8, 4)
  scene3d.add(dir)

  // Ground grid — subtle cyan
  const grid = new THREE.GridHelper(16, 32, 0x003322, 0x001a11)
  grid.position.y = -0.01
  scene3d.add(grid)

  buildCarModel()

  // Touch/mouse drag
  let drag = false, px = 0
  canvas.addEventListener('touchstart', e => { drag = true; px = e.touches[0].clientX; autoRotate3d = false })
  canvas.addEventListener('touchmove', e => { if (!drag || !carModel3d) return; carModel3d.rotation.y += (e.touches[0].clientX - px) * 0.01; px = e.touches[0].clientX })
  canvas.addEventListener('touchend', () => { drag = false; setTimeout(() => autoRotate3d = true, 4000) })
  canvas.addEventListener('mousedown', e => { drag = true; px = e.clientX; autoRotate3d = false })
  canvas.addEventListener('mousemove', e => { if (!drag || !carModel3d) return; carModel3d.rotation.y += (e.clientX - px) * 0.01; px = e.clientX })
  canvas.addEventListener('mouseup', () => { drag = false; setTimeout(() => autoRotate3d = true, 4000) })

  animate3D()

  // Update HUD
  const dc = document.getElementById('wa-3d-dmg-count')
  if (dc) dc.textContent = damages.length || '0'
  const st = document.getElementById('wa-3d-status')
  if (st) { st.textContent = 'VOLTOOID (100%)'; st.style.color = '#00FF9C' }
}

function buildCarModel() {
  carModel3d = new THREE.Group()
  const wireColor = 0x00FF9C
  const wireOp = 0.35
  const solidOp = 0.04

  // ═══ BODY — rounded box shape ═══
  const bodyShape = new THREE.Shape()
  bodyShape.moveTo(-1.9, 0.2)
  bodyShape.lineTo(-1.9, 0.7)
  bodyShape.lineTo(-1.6, 0.85)
  bodyShape.lineTo(1.6, 0.85)
  bodyShape.lineTo(1.9, 0.7)
  bodyShape.lineTo(1.9, 0.2)
  bodyShape.lineTo(-1.9, 0.2)

  const bodyExtrudeSettings = { depth: 1.7, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 }
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, bodyExtrudeSettings)
  bodyGeo.center()
  
  // Wireframe body
  const bodyWire = new THREE.LineSegments(
    new THREE.EdgesGeometry(bodyGeo, 15),
    new THREE.LineBasicMaterial({ color: wireColor, transparent: true, opacity: wireOp })
  )
  bodyWire.position.y = 0.55
  carModel3d.add(bodyWire)
  
  // Solid fill (very transparent)
  const bodySolid = new THREE.Mesh(bodyGeo, new THREE.MeshBasicMaterial({ color: wireColor, transparent: true, opacity: solidOp }))
  bodySolid.position.y = 0.55
  carModel3d.add(bodySolid)

  // ═══ CABIN — greenhouse ═══
  const cabShape = new THREE.Shape()
  cabShape.moveTo(-0.8, 0)
  cabShape.lineTo(-0.7, 0.55)
  cabShape.lineTo(0.5, 0.55)
  cabShape.lineTo(0.8, 0)
  cabShape.lineTo(-0.8, 0)

  const cabExtrudeSettings = { depth: 1.4, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 }
  const cabGeo = new THREE.ExtrudeGeometry(cabShape, cabExtrudeSettings)
  cabGeo.center()

  const cabWire = new THREE.LineSegments(
    new THREE.EdgesGeometry(cabGeo, 15),
    new THREE.LineBasicMaterial({ color: wireColor, transparent: true, opacity: wireOp * 0.7 })
  )
  cabWire.position.set(-0.1, 1.1, 0)
  carModel3d.add(cabWire)

  const cabSolid = new THREE.Mesh(cabGeo, new THREE.MeshBasicMaterial({ color: wireColor, transparent: true, opacity: solidOp * 0.5 }))
  cabSolid.position.set(-0.1, 1.1, 0)
  carModel3d.add(cabSolid)

  // ═══ WHEELS — torus + cylinder ═══
  const wheelGeo = new THREE.TorusGeometry(0.28, 0.1, 8, 16)
  const wheelMat = new THREE.LineBasicMaterial({ color: wireColor, transparent: true, opacity: wireOp * 0.8 })
  const hubGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.22, 8)
  const positions = [[1.25, 0.3, 0.88], [1.25, 0.3, -0.88], [-1.25, 0.3, 0.88], [-1.25, 0.3, -0.88]]
  positions.forEach(([x,y,z]) => {
    const wWire = new THREE.LineSegments(new THREE.EdgesGeometry(wheelGeo), wheelMat.clone())
    wWire.rotation.y = Math.PI/2
    wWire.position.set(x, y, z)
    carModel3d.add(wWire)
    const hub = new THREE.LineSegments(new THREE.EdgesGeometry(hubGeo), wheelMat.clone())
    hub.rotation.x = Math.PI/2
    hub.position.set(x, y, z)
    carModel3d.add(hub)
  })

  // ═══ HEADLIGHTS ═══
  const hlGeo = new THREE.SphereGeometry(0.1, 8, 8)
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })
  const hl1 = new THREE.Mesh(hlGeo, hlMat); hl1.position.set(1.88, 0.6, 0.55)
  const hl2 = new THREE.Mesh(hlGeo, hlMat); hl2.position.set(1.88, 0.6, -0.55)
  carModel3d.add(hl1, hl2)

  // ═══ Additional wireframe mesh lines for realism ═══
  // Hood line
  const hoodPts = [new THREE.Vector3(0.5, 0.9, -0.85), new THREE.Vector3(0.5, 0.9, 0.85)]
  const hoodGeo = new THREE.BufferGeometry().setFromPoints(hoodPts)
  carModel3d.add(new THREE.Line(hoodGeo, new THREE.LineBasicMaterial({ color: wireColor, transparent: true, opacity: wireOp * 0.4 })))
  
  // Door lines
  for (const xp of [-0.3, 0.5]) {
    const doorPts = [new THREE.Vector3(xp, 0.2, 0.86), new THREE.Vector3(xp, 0.85, 0.86), new THREE.Vector3(xp, 1.1, 0.71)]
    const doorGeo = new THREE.BufferGeometry().setFromPoints(doorPts)
    carModel3d.add(new THREE.Line(doorGeo, new THREE.LineBasicMaterial({ color: wireColor, transparent: true, opacity: wireOp * 0.3 })))
    const doorPts2 = doorPts.map(p => new THREE.Vector3(p.x, p.y, -p.z))
    carModel3d.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(doorPts2), new THREE.LineBasicMaterial({ color: wireColor, transparent: true, opacity: wireOp * 0.3 })))
  }

  // Trunk line
  const trunkPts = [new THREE.Vector3(-1.5, 0.9, -0.85), new THREE.Vector3(-1.5, 0.9, 0.85)]
  carModel3d.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(trunkPts), new THREE.LineBasicMaterial({ color: wireColor, transparent: true, opacity: wireOp * 0.4 })))

  scene3d.add(carModel3d)
}

function add3DDamageMarkers(dmgs) {
  if (!scene3d || !carModel3d) return
  damageMarkers3d.forEach(m => carModel3d.remove(m))
  damageMarkers3d = []

  const zonePositions = {
    'VOORKANT': [1.9, 0.6, 0],
    'RECHTS-VOOR': [1.3, 0.6, -0.9],
    'RECHTS': [0, 0.6, -0.9],
    'RECHTS-ACHTER': [-1.3, 0.6, -0.9],
    'ACHTERKANT': [-1.9, 0.6, 0],
    'LINKS-ACHTER': [-1.3, 0.6, 0.9],
    'LINKS': [0, 0.6, 0.9],
    'LINKS-VOOR': [1.3, 0.6, 0.9],
    'DAK': [0, 1.4, 0],
    'MOTORKAP': [1.2, 0.9, 0],
    'KOFFERBAK': [-1.5, 0.85, 0],
  }

  // All 8 zones — mark OK or damaged
  const allZones = ['VOORKANT','RECHTS-VOOR','RECHTS','RECHTS-ACHTER','ACHTERKANT','LINKS-ACHTER','LINKS','LINKS-VOOR']
  const damagedZones = new Set(dmgs.map(d => (d.zone || '').toUpperCase()))

  // Add OK labels to undamaged zones
  allZones.forEach(zone => {
    const pos = zonePositions[zone]
    if (!pos) return
    if (!damagedZones.has(zone)) {
      // Green OK marker
      const sprite = makeTextSprite('OK', { color: '#00FF9C', bg: 'rgba(0,255,156,0.1)', border: 'rgba(0,255,156,0.3)' })
      sprite.position.set(pos[0], pos[1] + 0.35, pos[2])
      sprite.scale.set(0.5, 0.25, 1)
      carModel3d.add(sprite)
      damageMarkers3d.push(sprite)
    }
  })

  // Add damage markers
  dmgs.forEach((d, i) => {
    const zone = (d.zone || '').toUpperCase()
    const pos = zonePositions[zone] || [0, 0.8, 0]
    const isErnstig = d.sev === 'ernstig' || d.sev === 'zwaar'
    const color = isErnstig ? 0xff2244 : d.sev === 'gemiddeld' ? 0xff8800 : 0xffbb00

    // Red/orange glow sphere
    const glowGeo = new THREE.SphereGeometry(0.25, 16, 16)
    const glowMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.15 })
    const glow = new THREE.Mesh(glowGeo, glowMat)
    glow.position.set(pos[0], pos[1], pos[2])
    glow._pulsePhase = i * 0.8
    carModel3d.add(glow)
    damageMarkers3d.push(glow)

    // Core marker
    const coreGeo = new THREE.SphereGeometry(0.08, 12, 12)
    const coreMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.9 })
    const core = new THREE.Mesh(coreGeo, coreMat)
    core.position.set(pos[0], pos[1], pos[2])
    carModel3d.add(core)
    damageMarkers3d.push(core)

    // Damage label sprite
    const label = d.type || d.description?.split(' ')[0] || 'Schade'
    const sprite = makeTextSprite(label, { color: '#fff', bg: 'rgba(255,34,68,0.85)', border: 'rgba(255,68,68,0.6)' })
    sprite.position.set(pos[0], pos[1] + 0.5, pos[2])
    sprite.scale.set(0.7, 0.25, 1)
    carModel3d.add(sprite)
    damageMarkers3d.push(sprite)

    // Line from marker to label
    const linePts = [new THREE.Vector3(pos[0], pos[1] + 0.1, pos[2]), new THREE.Vector3(pos[0], pos[1] + 0.4, pos[2])]
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts)
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.6 }))
    carModel3d.add(line)
    damageMarkers3d.push(line)

    // Color the wireframe zone red — find nearby wireframe edges
    carModel3d.children.forEach(child => {
      if (child.isLineSegments && child.material.color) {
        const dist = child.position.distanceTo(new THREE.Vector3(pos[0], pos[1], pos[2]))
        if (dist < 1.5 && child.material.opacity < 0.5) {
          // Tint nearby wireframes red
          const tintMat = child.material.clone()
          tintMat.color.set(color)
          tintMat.opacity = Math.min(tintMat.opacity * 2, 0.6)
          child.material = tintMat
        }
      }
    })
  })

  // Zone status grid
  renderZoneGrid(allZones, damagedZones, dmgs)
}

function makeTextSprite(text, opts) {
  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 64
  const ctx = canvas.getContext('2d')
  
  // Background
  ctx.fillStyle = opts.bg || 'rgba(0,0,0,0.7)'
  ctx.beginPath()
  ctx.roundRect(4, 4, 248, 56, 12)
  ctx.fill()
  ctx.strokeStyle = opts.border || 'rgba(255,255,255,0.2)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(4, 4, 248, 56, 12)
  ctx.stroke()
  
  // Text
  ctx.font = 'bold 28px -apple-system, sans-serif'
  ctx.fillStyle = opts.color || '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 34)
  
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true })
  return new THREE.Sprite(mat)
}

function renderZoneGrid(allZones, damagedZones, dmgs) {
  const grid = document.getElementById('wa-zone-grid')
  if (!grid) return
  grid.innerHTML = allZones.map(zone => {
    const isDamaged = damagedZones.has(zone)
    const dmg = dmgs.find(d => (d.zone || '').toUpperCase() === zone)
    const bg = isDamaged ? 'rgba(255,34,68,.08)' : 'rgba(0,255,156,.05)'
    const border = isDamaged ? 'rgba(255,68,68,.25)' : 'rgba(0,255,156,.15)'
    const color = isDamaged ? '#ff4444' : '#00FF9C'
    const icon = isDamaged ? '⚠' : '✓'
    const label = isDamaged ? (dmg?.type || 'Schade') : 'OK'
    return '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:10px;padding:8px;text-align:center">' +
      '<div style="font-size:14px">' + icon + '</div>' +
      '<div style="font-size:9px;font-weight:700;color:' + color + ';margin-top:2px">' + label + '</div>' +
      '<div style="font-size:8px;color:rgba(255,255,255,.4);margin-top:1px">' + zone + '</div></div>'
  }).join('')
}

function animate3D() {
  if (!renderer3d || !scene3d) return
  requestAnimationFrame(animate3D)
  if (autoRotate3d && carModel3d) carModel3d.rotation.y += rotateSpeed3d

  // Pulse damage glow markers
  const t = Date.now() * 0.001
  damageMarkers3d.forEach(m => {
    if (m._pulsePhase !== undefined) {
      const s = 1 + Math.sin(t * 2.5 + m._pulsePhase) * 0.4
      m.scale.set(s, s, s)
    }
  })
  renderer3d.render(scene3d, camera3d)
}

function rotate3DModel(dir) {
  if (!carModel3d) return
  autoRotate3d = false
  carModel3d.rotation.y += dir * 0.5
  setTimeout(() => autoRotate3d = true, 4000)
}


// Hook into showDamageMap to init 3D viewer
const _origShowDamageMap = typeof showDamageMap === 'function' ? showDamageMap : null

// ── Save inspectie ──
async function saveInspectie() {
  if (!aiScanResult) { toast('Geen scan resultaat', 'warning'); return }
  
  const plate = document.getElementById('wa-plate')?.value?.trim()
  const token = _t4cToken()
  
  try {
    const resp = await fetch('/api/inspecties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer '+token },
      body: JSON.stringify({
        kenteken: plate,
        overall_score: aiScanResult.overall_score,
        paint_score: aiScanResult.paint_score,
        body_score: aiScanResult.body_score,
        total_cost: damages.reduce((s,d) => s+(d.cost||0), 0),
        damages: JSON.stringify(damages),
        summary: aiScanResult.summary,
        photos: JSON.stringify(waFrames.map(f => ({ zone:f.zone, angle:f.angle }))),
        gpt_raw: JSON.stringify(aiScanResult),
        frames_captured: waFrames.length,
        scan_duration: Math.round((Date.now() - waStartTime) / 1000)
      })
    })
    const d = await resp.json()
    if (d.success) {
      playZoneCapture()
      toast('Inspectie opgeslagen ✓', 'success')
    } else throw new Error(d.error)
  } catch(e) {
    toast('Opslaan mislukt: ' + e.message, 'error')
  }
}

// ── Audio scan ──
async function toggleAudioScan() {
  if (waAudioActive) {
    stopAudioScan()
    return
  }
  try {
    waAudioStream = await navigator.mediaDevices.getUserMedia({ audio:true })
    waAudioCtx = new AudioContext()
    const src = waAudioCtx.createMediaStreamSource(waAudioStream)
    waAudioAnalyser = waAudioCtx.createAnalyser()
    waAudioAnalyser.fftSize = 256
    src.connect(waAudioAnalyser)
    
    waAudioActive = true
    document.getElementById('wa-audio-btn').textContent = '■ Stop'
    
    const viz = document.getElementById('wa-audio-viz')
    if (viz) { viz.style.display = 'flex' }
    
    const bufLen = waAudioAnalyser.frequencyBinCount
    const dataArr = new Uint8Array(bufLen)
    
    // Visualizer
    const bars = Array.from({length:20}, () => {
      const b = document.createElement('div')
      b.style.cssText = 'width:4px;background:var(--green);border-radius:2px;transition:height .1s'
      viz.appendChild(b)
      return b
    })
    
    waAudioInterval = setInterval(() => {
      waAudioAnalyser.getByteFrequencyData(dataArr)
      bars.forEach((b,i) => {
        const h = Math.max(2, Math.round(dataArr[i*3] / 255 * 30))
        b.style.height = h + 'px'
      })
    }, 100)
    
    // Record 5 seconds then analyze
    const chunks = []
    const rec = new MediaRecorder(waAudioStream)
    rec.ondataavailable = e => chunks.push(e.data)
    rec.onstop = async () => {
      const blob = new Blob(chunks)
      const reader = new FileReader()
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1]
        const plate = document.getElementById('wa-plate')?.value?.trim()
        try {
          const r = await fetch('/api/analyze-audio', {
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+_t4cToken()},
            body: JSON.stringify({ audio: base64, kenteken: plate })
          })
          const d = await r.json()
          if (d.result) {
            const el = document.getElementById('wa-audio-result')
            if (el) { el.style.display='block'; el.textContent = d.result }
          }
        } catch(e) {}
      }
      reader.readAsDataURL(blob)
    }
    rec.start()
    setTimeout(() => { rec.stop(); stopAudioScan() }, 5000)
    
  } catch(e) {
    toast('Microfoon toegang geweigerd', 'error')
  }
}

function stopAudioScan() {
  waAudioActive = false
  clearInterval(waAudioInterval)
  if (waAudioStream) waAudioStream.getTracks().forEach(t => t.stop())
  const btn = document.getElementById('wa-audio-btn')
  if (btn) btn.textContent = '▶ Start'
}

function resetScan() {
  waFrames = []; waCapturedZones = new Set()
  aiScanResult = null; damages = []
  const c = document.getElementById('wa-photo-count')
  if (c) c.textContent = '0'
}


// Init on page load
document.addEventListener('DOMContentLoaded', () => {
  if (_t4cToken()) {
    document.querySelector('.bnav').style.display='flex';
    // Handle PWA shortcuts
    const hash = location.hash.replace('#','');
    if (hash && document.getElementById('s-'+hash)) {
      go(hash);
    } else {
      go('home');
    }
  } else {
    document.getElementById('s-login').classList.add('active');
    document.querySelector('.bnav').style.display='none';
  }
});
