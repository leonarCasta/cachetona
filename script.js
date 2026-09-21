document.getElementById('top-title').textContent = CONFIG.titulo;

const letterBody = document.getElementById('love-letter-body');
(CONFIG.mensaje || DEFAULTS.mensaje).split(/\n\s*\n/).forEach((paragraph) => {
  const p = document.createElement('p');
  p.textContent = paragraph.trim();
  letterBody.appendChild(p);
});

const startScreen = document.getElementById('start-screen');
const audio = document.getElementById('audio');
audio.src = CONFIG.musica;
audio.preload = 'auto';
audio.load();

let experienceStarted = false;
function unlockAudioAndStart() {
  if (experienceStarted) return;
  experienceStarted = true;
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(err => console.log("Audio no autoplay:", err));
  }
  startScreen.classList.add('hidden');
}
startScreen.addEventListener('touchend', (e) => {
  e.preventDefault();
  unlockAudioAndStart();
}, {passive: false});
startScreen.addEventListener('click', unlockAudioAndStart);

const isMobile = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent) || window.innerWidth <= 820;

// ================= Botón de mensaje =================
const letterBtn = document.getElementById('love-letter-btn');
const letterOverlay = document.getElementById('love-letter-overlay');
const letterClose = document.getElementById('love-letter-close');
function openLetter(){ letterOverlay.classList.add('visible'); }
function closeLetter(){ letterOverlay.classList.remove('visible'); }
letterBtn.addEventListener('click', openLetter);
letterClose.addEventListener('click', closeLetter);
letterOverlay.addEventListener('click', (e) => { if (e.target === letterOverlay) closeLetter(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLetter(); });

// ================= Escena Three.js =================
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({canvas, antialias: !isMobile});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000);

// --- Cámara con ángulos Euler acumulados correctamente ---
let targetDist = 400, currentDist = 400;
let rotX = 0.2;
let rotY = 0;

// Fondo: negro solido + el campo de estrellas generado abajo. La plantilla
// original (freegalaxy-dia-novia) cargaba una textura de nebulosa remota
// desde raw.githubusercontent.com - mismo hallazgo que en
// galaxia-nebulosa-flores-amarillas (esa URL ya no resuelve, 404 silencioso,
// nunca se llego a ver ni antes de este cambio) - se quita en vez de dejar
// una dependencia externa rota.

// Textura circular suave
function makeDotTexture(){
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,1)');
  grad.addColorStop(0.85, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
const dotTexture = makeDotTexture();

// Estrellas de fondo
(function makeStars(count = isMobile ? 1400 : 2200, spread=3000){
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for(let i=0; i<count; i++){
    const r = spread * (0.3 + Math.random() * 0.7);
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i*3+0] = r * Math.sin(ph) * Math.cos(th);
    pos[i*3+1] = r * Math.cos(ph);
    pos[i*3+2] = r * Math.sin(ph) * Math.sin(th);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({
    size: 2.2,
    sizeAttenuation: false,
    map: dotTexture,
    transparent: true,
    alphaTest: 0.01,
    depthWrite: false,
    opacity: 0.9,
    color: 0xfff4d9
  })));
})();

// ================= Corazón <-> Flor =================
// El centro de la galaxia ya no es un corazon fijo: cada tanto se
// transforma en una flor (una rosa polar de 8 petalos) y vuelve a ser
// corazon, en un ciclo continuo. La forma se guarda en DOS arreglos de
// posiciones del MISMO tamaño (heartPos/flowerPos) - cada frame, la
// posicion real de cada particula es una interpolacion lineal entre su
// punto en el corazon y su punto en la flor, segun cuanto haya avanzado
// el ciclo (shapeMixAt). Barato: son sumas y multiplicaciones simples
// sobre un Float32Array ya reservado, sin crear geometria nueva en cada
// frame.
function heartCurve(t){
  const x = 16 * Math.pow(Math.sin(t), 3);
  const y = 13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t);
  return { x, y };
}
// Rosa polar r = 16*cos(4*theta): k par -> 2k = 8 petalos, mismo radio
// maximo (~16) que heartCurve para que ambas formas ocupen un volumen
// comparable y el morph no "salte" de tamaño.
function flowerCurve(t){
  const r = 16 * Math.cos(4 * t);
  return { x: r * Math.cos(t), y: r * Math.sin(t) };
}

const HEART_SCALE = 3.2;
const SHAPE_THICKNESS = 3.4;
const SHAPE_DEPTH = 8.5;
const HEART_Y_OFFSET = 6; // centra visualmente el corazon (su curva parametrica no es simetrica en Y)

function buildShapePositions(curveFn, count, yOffset){
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = Math.random() * Math.PI * 2;
    const p0 = curveFn(t);
    const p1 = curveFn(t + 0.001);
    const tx = p1.x - p0.x, ty = p1.y - p0.y;
    const tLen = Math.hypot(tx, ty) || 1;
    const nx = -ty / tLen, ny = tx / tLen;
    const offset = (Math.random() - 0.5) * SHAPE_THICKNESS;

    const rawX = p0.x + nx * offset;
    const rawY = p0.y + ny * offset + yOffset;

    const ix = i * 3;
    arr[ix]   = rawX * HEART_SCALE;
    arr[ix+1] = rawY * HEART_SCALE;
    arr[ix+2] = (Math.random() - 0.5) * SHAPE_DEPTH;
  }
  return arr;
}

const HEART_COUNT = isMobile ? 4400 : 5800;
const heartPos = buildShapePositions(heartCurve, HEART_COUNT, HEART_Y_OFFSET);
const flowerPos = buildShapePositions(flowerCurve, HEART_COUNT, 0);
const wordPos = new Float32Array(HEART_COUNT * 3); // se llena en document.fonts.ready
const shapePos = heartPos.slice(); // posicion real que se dibuja, arranca en corazon
const SHAPE_SETS = [heartPos, flowerPos, wordPos];

// Llena `out` (Float32Array de count*3) con puntos que dibujan el texto
// `text`, muestreados de un canvas 2D. Mismo tamano de particulas que el
// corazon/flor para que el morph sea parejo entre las tres formas.
function buildWordPositionsInto(out, text, count){
  const w = 1024, h = 256;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = h * 0.74;
  ctx.font = '900 ' + size + 'px "Indie Flower","Bradley Hand","Segoe Script",cursive';
  while (ctx.measureText(text).width > w - 40 && size > 44) {
    size -= 4;
    ctx.font = '900 ' + size + 'px "Indie Flower","Bradley Hand","Segoe Script",cursive';
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 10;
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillText(text, w / 2, h / 2);
  const data = ctx.getImageData(0, 0, w, h).data;
  const textWidth = ctx.measureText(text).width;
  const pts = [];
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (data[(y * w + x) * 4 + 3] > 128) pts.push([x, y]);
    }
  }
  const sc = 105 / textWidth; // ~mismo ancho que el corazon (~102 unidades)
  for (let i = 0; i < count; i++) {
    const src = pts[Math.floor(Math.random() * pts.length)];
    const ix = i * 3;
    out[ix]   = (src[0] - w / 2) * sc + (Math.random() - 0.5) * 1.0;
    out[ix+1] = (h / 2 - src[1]) * sc + (Math.random() - 0.5) * 1.0;
    out[ix+2] = (Math.random() - 0.5) * SHAPE_DEPTH;
  }
}

const heartGeom = new THREE.BufferGeometry();
heartGeom.setAttribute('position', new THREE.BufferAttribute(shapePos, 3));
const heartMat = new THREE.PointsMaterial({
  color: 0xffc93d,
  size: 1.2,
  map: dotTexture,
  transparent: true,
  alphaTest: 0.01,
  depthWrite: false,
  opacity: 0.95,
  blending: THREE.AdditiveBlending
});
const heart = new THREE.Points(heartGeom, heartMat);
scene.add(heart);

// Cuanto dura cada forma quieta y cuanto la transicion entre una y otra -
// ver shapePhaseAt() mas abajo, usado dentro del loop de animacion.
const SHAPE_HOLD_SECONDS = 6;
const SHAPE_MORPH_SECONDS = 2.4;
function easeInOutCubic(x){ return x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x+2, 3)/2; }
// Devuelve la transicion activa entre las tres formas:
// 0 = corazon, 1 = flor, 2 = palabra "Nunki". El ciclo es continuo:
// corazon -> flor -> Nunki -> corazon -> flor -> Nunki -> ...
function shapePhaseAt(elapsedSec){
  const step = SHAPE_HOLD_SECONDS + SHAPE_MORPH_SECONDS;
  const p = elapsedSec % (step * 3);
  const slot = Math.floor(p / step);
  const within = p - slot * step;
  if (within < SHAPE_HOLD_SECONDS) {
    return { from: slot, to: slot, mix: 0 };
  }
  return {
    from: slot,
    to: (slot + 1) % 3,
    mix: easeInOutCubic((within - SHAPE_HOLD_SECONDS) / SHAPE_MORPH_SECONDS)
  };
}
const sceneStartMs = performance.now();

// ================= Espiral — mismo brillo que el corazón =================
const spiralPoints = [];
const arms = 4;
const SPIRAL_COUNT = isMobile ? 4600 : 7000;
for (let i = 0; i < SPIRAL_COUNT; i++) {
  const r = Math.random() * 250;
  const armIndex = Math.floor(Math.random() * arms);
  const theta = (armIndex * Math.PI * 2 / arms) + (r * 0.02) + (Math.random() * 0.4 - 0.2);
  const sx = Math.cos(theta) * r;
  const sz = Math.sin(theta) * r;
  const sy = -35 - (r * 0.4) + (Math.random() * 8 - 4);
  spiralPoints.push(new THREE.Vector3(sx, sy, sz));
}
const spiralGeom = new THREE.BufferGeometry().setFromPoints(spiralPoints);
// Mas grande que el corazon/flor (1.2 -> 2.1) y con su propio glow aditivo
// - pedido explicito: la base en espiral se perdia contra el resto de la
// escena, tenia que notarse mas.
const spiralMat = new THREE.PointsMaterial({
  color: 0xffd966,
  size: 2.1,
  map: dotTexture,
  transparent: true,
  alphaTest: 0.01,
  depthWrite: false,
  opacity: 1,
  blending: THREE.AdditiveBlending
});
const spiral = new THREE.Points(spiralGeom, spiralMat);
scene.add(spiral);

// ================= Polvo fino =================
const DUST_INNER_R = 150;
const DUST_OUTER_R = 380;
const dustPoints = [];
const DUST_COUNT = isMobile ? 7000 : 14000;
for (let i = 0; i < DUST_COUNT; i++) {
  const r = DUST_INNER_R + Math.random() * (DUST_OUTER_R - DUST_INNER_R);
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  dustPoints.push(new THREE.Vector3(
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  ));
}
const dustGeom = new THREE.BufferGeometry().setFromPoints(dustPoints);
const dustMat = new THREE.PointsMaterial({
  color: 0xfff0c2,
  size: 1.0,
  map: dotTexture,
  transparent: true,
  alphaTest: 0.01,
  depthWrite: false,
  opacity: 0.55,
  blending: THREE.AdditiveBlending
});
const dust = new THREE.Points(dustGeom, dustMat);
scene.add(dust);

// Esfera de colisión (referencia de escala del corazon/flor, invisible)
const hitSphere = new THREE.Mesh(
  new THREE.SphereGeometry(62, 16, 16),
  new THREE.MeshBasicMaterial({visible: false})
);
scene.add(hitSphere);

// Glow central
function makeGlow(size=768, c1='255,201,61', c2='255,160,40'){
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size/2, size/2, size*0.05, size/2, size/2, size*0.5);
  grad.addColorStop(0, 'rgba(' + c1 + ',0.7)');
  grad.addColorStop(0.5, 'rgba(' + c2 + ',0.2)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
const glow = new THREE.Sprite(new THREE.SpriteMaterial({map: makeGlow(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}));
glow.scale.set(450, 450, 1);
scene.add(glow);

// Anillos
function ringTexture(size=768){
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); g.translate(size/2, size/2);
  const r1 = size*0.35, r2 = size*0.48;
  const grd = g.createRadialGradient(0, 0, r1*0.6, 0, 0, r2);
  grd.addColorStop(0.0, 'rgba(255,244,214,1)');
  grd.addColorStop(0.3, 'rgba(255,204,51,1)');
  grd.addColorStop(0.7, 'rgba(200,140,20,0.8)');
  grd.addColorStop(1.0, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(0,0,r2,0,Math.PI*2); g.arc(0,0,r1,0,Math.PI*2,true); g.closePath(); g.fill();
  return new THREE.CanvasTexture(c);
}
const ring1 = new THREE.Mesh(new THREE.RingGeometry(80, 115, 128), new THREE.MeshBasicMaterial({map: ringTexture(), transparent: true, side: THREE.DoubleSide, opacity: 0.32, blending: THREE.AdditiveBlending}));
const ring2 = new THREE.Mesh(new THREE.RingGeometry(125, 155, 128), new THREE.MeshBasicMaterial({map: ringTexture(), transparent: true, side: THREE.DoubleSide, opacity: 0.2, blending: THREE.AdditiveBlending}));
ring1.rotation.x = ring2.rotation.x = Math.PI/2;
scene.add(ring1); scene.add(ring2);

// ================= Frases =================
// Se repiten para llenar toda la esfera de la galaxia (mismo criterio que
// galaxia-nebulosa/dorada-flores-amarillas).
const WORDS = [];
const baseWords = (Array.isArray(CONFIG.frases) && CONFIG.frases.length) ? CONFIG.frases : DEFAULTS.frases;
const PHRASE_REPEAT = isMobile ? 4 : 6;
for(let i=0; i<PHRASE_REPEAT; i++){ WORDS.push(...baseWords); }

function makeTextTexture(text, color){
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
  const ctx = c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let fontSize = 50;
  ctx.font = `700 ${fontSize}px "Indie Flower", cursive`;
  while (ctx.measureText(text).width > c.width - 50 && fontSize > 26) {
    fontSize -= 2;
    ctx.font = `700 ${fontSize}px "Indie Flower", cursive`;
  }
  ctx.fillStyle = '#fffbe8'; ctx.shadowColor = color; ctx.shadowBlur = 25;
  ctx.fillText(text, c.width/2, c.height/2);
  return new THREE.CanvasTexture(c);
}
const COLORS = ['#ffcc33','#ffb300','#ffe066','#f5a623','#ffd700','#fff2b2','#e6a817','#ffbf4d','#fff4c2'];
const textGroup = new THREE.Group(); scene.add(textGroup);

document.fonts.ready.then(() => {
  buildWordPositionsInto(wordPos, 'Mi Starlight', HEART_COUNT);
  for(let i=0; i<WORDS.length; i++){
    const tex = makeTextTexture(WORDS[i], COLORS[i%COLORS.length]);
    const mat = new THREE.SpriteMaterial({map: tex, transparent: true, depthWrite: false, alphaTest: 0.01});
    const sp = new THREE.Sprite(mat);
    sp.scale.set(98, 12.25, 1);
    const phi = Math.acos(2 * Math.random() - 1); const theta = Math.random() * Math.PI * 2;
    const r = DUST_INNER_R + Math.random() * (DUST_OUTER_R - DUST_INNER_R - 30);
    sp.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
    sp.userData = {phi: phi, theta: theta, radius: r, speed: 0.001 + Math.random() * 0.001};
    textGroup.add(sp);
  }
});

// ================= Fotos flotantes =================
// A diferencia del original (que embebia las fotos en base64 para poder
// abrirse con doble-click via file://), el HTML publicado siempre se sirve
// por HTTP real - las rutas relativas ya cargan bien tal cual, sin
// necesitar esa copia embebida (mismo criterio que el resto del catalogo).
const photoGroup = new THREE.Group(); scene.add(photoGroup);
const photoGlowTex = makeGlow(512, '255,224,153', '255,204,51');
const loader = new THREE.TextureLoader();

const PHOTO_PATHS = (Array.isArray(CONFIG.fotos) && CONFIG.fotos.length) ? CONFIG.fotos : DEFAULTS.fotos;
const PHOTO_REPEAT = isMobile ? 7 : 12;
const PHOTO_INSTANCES = [];
for (let rep = 0; rep < PHOTO_REPEAT; rep++) { PHOTO_INSTANCES.push(...PHOTO_PATHS); }

PHOTO_INSTANCES.forEach((path) => {
  const phi = Math.acos(2 * Math.random() - 1);
  const theta = Math.random() * Math.PI * 2;
  const r = DUST_INNER_R + Math.random() * (DUST_OUTER_R - DUST_INNER_R - 30);
  const speed = 0.0007 + Math.random() * 0.0009;
  const baseSize = isMobile ? 30 : 42;

  const glowMat = new THREE.SpriteMaterial({
    map: photoGlowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.6,
    blending: THREE.AdditiveBlending
  });
  const glowSprite = new THREE.Sprite(glowMat);
  glowSprite.scale.set(baseSize * 1.6, baseSize * 1.6, 1);
  glowSprite.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  glowSprite.renderOrder = -1;
  glowSprite.userData = {phi: phi, theta: theta, radius: r, speed: speed};
  photoGroup.add(glowSprite);

  loader.load(
    path,
    (tex) => {
      const iw = (tex.image && tex.image.width) || 1;
      const ih = (tex.image && tex.image.height) || 1;
      const ratio = iw / ih;
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        opacity: 0.96
      });
      const photoSprite = new THREE.Sprite(mat);
      if (ratio >= 1) {
        photoSprite.scale.set(baseSize * ratio, baseSize, 1);
      } else {
        photoSprite.scale.set(baseSize, baseSize / ratio, 1);
      }
      photoSprite.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
      photoSprite.userData = {phi: phi, theta: theta, radius: r, speed: speed, isPhoto: true};
      photoGroup.add(photoSprite);
    },
    undefined,
    () => { console.log('No se pudo cargar ' + path + ' — revisa que el archivo exista en esa carpeta.'); }
  );
});

// ================= Controles de Cámara — Rotación Suave Sin Trabas =================
let isPointerDown = false;
let isDragging = false;
let startX = 0, startY = 0;
let targetRotX = 0.2, targetRotY = 0;
let velX = 0, velY = 0;

function onDown(e) {
  isPointerDown = true;
  isDragging = false;
  velX = 0; velY = 0;
  const t = e.touches ? e.touches[0] : e;
  startX = t.clientX;
  startY = t.clientY;
}

function onMove(e) {
  if (!isPointerDown) return;
  if (e.touches && e.touches.length > 1) return;
  const t = e.touches ? e.touches[0] : e;
  const dx = t.clientX - startX;
  const dy = t.clientY - startY;

  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
    isDragging = true;

    const sensX = (Math.PI * 1.5) / innerWidth;
    const sensY = (Math.PI * 0.8) / innerHeight;

    velY = -dx * sensX;
    velX =  dy * sensY;

    targetRotY += velY;
    targetRotX = Math.max(-1.25, Math.min(1.25, targetRotX + velX));

    startX = t.clientX;
    startY = t.clientY;
  }
}

function onUp() {
  isPointerDown = false;
}

const dom = renderer.domElement;
dom.addEventListener('mousedown', onDown);
dom.addEventListener('mousemove', onMove);
window.addEventListener('mouseup', onUp);

dom.addEventListener('touchstart', onDown, {passive: true});
dom.addEventListener('touchmove', onMove, {passive: true});
window.addEventListener('touchend', (e) => {
  if (!e.touches || e.touches.length === 0) {
    onUp();
  } else {
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    isDragging = false;
  }
}, {passive: true});

// ================= Zoom — Pinch Mejorado para Móvil =================
addEventListener('wheel', (e) => {
  targetDist += e.deltaY * 0.25;
  targetDist = Math.max(180, Math.min(1100, targetDist));
}, {passive: true});

let pinchDist = null;

function getPinchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    pinchDist = getPinchDist(e.touches);
    isPointerDown = false;
    isDragging = false;
  }
}, {passive: true});

addEventListener('touchmove', (e) => {
  if (e.touches.length === 2) {
    const newDist = getPinchDist(e.touches);
    if (pinchDist !== null) {
      const delta = pinchDist - newDist;
      targetDist += delta * 0.85;
      targetDist = Math.max(180, Math.min(1100, targetDist));
    }
    pinchDist = newDist;
  } else {
    if (pinchDist !== null) {
      pinchDist = null;
      if (e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isPointerDown = true;
        isDragging = false;
      }
    }
  }
}, {passive: true});

addEventListener('touchend', (e) => {
  if (e.touches.length < 2) {
    pinchDist = null;
  }
}, {passive: true});

// ================= Animación =================
let t = 0;
const INERTIA_DECAY = 0.88;

function tick(){
  requestAnimationFrame(tick);
  t += 0.01;

  if (!isPointerDown) {
    velX *= INERTIA_DECAY;
    velY *= INERTIA_DECAY;
    targetRotX = Math.max(-1.25, Math.min(1.25, targetRotX + velX));
    targetRotY += velY;
  }

  rotX += (targetRotX - rotX) * 0.12;
  rotY += (targetRotY - rotY) * 0.12;

  ring1.rotation.z += 0.002;
  ring2.rotation.z -= 0.0015;
  spiral.rotation.y -= 0.0045;
  dust.rotation.y += 0.0006;

  glow.scale.set(450 * (1 + Math.sin(t*0.4)*0.03), 450 * (1 + Math.sin(t*0.4)*0.03), 1);

  // Late del corazon/flor central
  const s = 1.0 + 0.05 * Math.sin(t * 4);
  heart.scale.set(s, s, s);
  hitSphere.scale.set(s, s, s);

  // Corazon <-> flor <-> Nunki: interpola cada particula entre su posicion
  // en la forma actual y su posicion en la siguiente, segun la fase del
  // ciclo (segundos, no frames - mismo ritmo sin importar el FPS).
  const elapsedSec = (performance.now() - sceneStartMs) / 1000;
  const phase = shapePhaseAt(elapsedSec);
  const fromArr = SHAPE_SETS[phase.from];
  const toArr = SHAPE_SETS[phase.to];
  const mix = phase.mix;
  const posArr = heartGeom.attributes.position.array;
  for (let i = 0; i < HEART_COUNT; i++) {
    const ix = i * 3;
    posArr[ix]   = fromArr[ix]   + (toArr[ix]   - fromArr[ix])   * mix;
    posArr[ix+1] = fromArr[ix+1] + (toArr[ix+1] - fromArr[ix+1]) * mix;
    posArr[ix+2] = fromArr[ix+2] + (toArr[ix+2] - fromArr[ix+2]) * mix;
  }
  heartGeom.attributes.position.needsUpdate = true;

  // Frases orbitando
  textGroup.children.forEach(sp => {
    sp.material.opacity = 0.8 + 0.2 * Math.sin(t * 2);
    sp.userData.theta += sp.userData.speed;
    sp.position.x = sp.userData.radius * Math.sin(sp.userData.phi) * Math.cos(sp.userData.theta);
    sp.position.z = sp.userData.radius * Math.sin(sp.userData.phi) * Math.sin(sp.userData.theta);
  });

  // Fotos orbitando
  photoGroup.children.forEach(sp => {
    sp.userData.theta += sp.userData.speed;
    sp.position.x = sp.userData.radius * Math.sin(sp.userData.phi) * Math.cos(sp.userData.theta);
    sp.position.z = sp.userData.radius * Math.sin(sp.userData.phi) * Math.sin(sp.userData.theta);
    if (sp.userData.isPhoto) {
      sp.material.opacity = 0.82 + 0.14 * Math.sin(t * 1.6 + sp.userData.radius);
    }
  });

  currentDist += (targetDist - currentDist) * 0.06;

  const camX = currentDist * Math.cos(rotX) * Math.sin(rotY);
  const camY = currentDist * Math.sin(rotX);
  const camZ = currentDist * Math.cos(rotX) * Math.cos(rotY);
  camera.position.set(camX, camY, camZ);
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}
tick();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
