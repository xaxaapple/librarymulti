/* ==========================================================
   3D LIBRARY — FPS + REAL INTERNET MULTIPLAYER (PeerJS + MQTT + invite link)
   + DESKTOP & MOBILE CONTROLS + JUMP + SMART TV
   ========================================================== */

/* ---------------------- Global State ---------------------- */

let scene, camera, renderer;
let clock = new THREE.Clock();
let raycaster = new THREE.Raycaster();

let yawObject, pitchObject;
let playerHeight = 1.7;
let worldHalfSize = 14;

const moveState = { forward: false, backward: false, left: false, right: false };
let joystickVector = { x: 0, z: 0 };
let pointerLocked = false;
let isMobile = false;

/* Jump / gravity */
let verticalVelocity = 0;
let isGrounded = true;
const GRAVITY = -16;
const JUMP_SPEED = 6.2;

let nickname = "";
let myPeer = null;
let myPeerId = null;
let connections = {};
let remotePlayers = {};
let lastSeenPeers = {};

let mqttClient = null;
let signalReady = false;
const MQTT_BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';
const PRESENCE_TOPIC = 'library3dfps/presence/v2';

let animatedObjects = [];
let lights = {};

let gameStarted = false;
let elapsedTime = 0;
let timerFrozen = false;

const PHASE1_END = 60;
const PHASE2_END = 90;
const PHASE3_END = 95;

let currentPhase = 1;
let glitchTriggered = false;
let glitchAudioCtx = null;

/* TV state */
let tvGroup = null;
let tvScreenMesh = null;
let tvScreenWidth = 1.7;
let tvScreenHeight = 0.96;
let tvActive = false;
let tvNearPlayer = false;
let ytPlayer = null;
let ytApiReady = false;
let pendingYouTubeLoad = null;
let tvUsingGenericIframe = false;

/* ---------------------- DOM References ---------------------- */

const startOverlay = document.getElementById('start-overlay');
const nicknameInput = document.getElementById('nickname-input');
const startBtn = document.getElementById('start-btn');
const startError = document.getElementById('start-error');
const connectionStatus = document.getElementById('connection-status');
const inviteLinkInput = document.getElementById('invite-link-input');
const inviteCopyBtn = document.getElementById('invite-copy-btn');

const hud = document.getElementById('hud');
const timerValue = document.getElementById('timer-value');
const playersCount = document.getElementById('players-count');
const blockerMsg = document.getElementById('blocker-msg');
const glitchCanvas = document.getElementById('glitch-canvas');
const glitchCtx = glitchCanvas.getContext('2d');
const joystickZone = document.getElementById('joystick-zone');
const joystickBase = document.getElementById('joystick-base');
const joystickKnob = document.getElementById('joystick-knob');
const lookZone = document.getElementById('look-zone');
const mobileExitBtn = document.getElementById('mobile-exit-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const jumpBtn = document.getElementById('jump-btn');
const tvInteractBtn = document.getElementById('tv-interact-btn');
const interactPrompt = document.getElementById('interact-prompt');

const tvScreenOverlay = document.getElementById('tv-screen-overlay');
const tvModal = document.getElementById('tv-modal');
const tvUrlInput = document.getElementById('tv-url-input');
const tvPlayBtn = document.getElementById('tv-play-btn');
const tvStopBtn = document.getElementById('tv-stop-btn');
const tvCloseBtn = document.getElementById('tv-close-btn');
const tvQualitySelect = document.getElementById('tv-quality-select');
const tvError = document.getElementById('tv-error');
const tvNote = document.getElementById('tv-note');

/* ==========================================================
   DEVICE DETECTION
   ========================================================== */

function detectMobile() {
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent);
  const touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const narrow = window.innerWidth <= 900;
  return uaMobile || (touchCapable && narrow);
}

/* ==========================================================
   INITIALIZATION
   ========================================================== */

function initScene() {
  isMobile = detectMobile();
  if (isMobile) document.body.classList.add('is-mobile');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0906);
  scene.fog = new THREE.FogExp2(0x0b0906, 0.028);

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);

  pitchObject = new THREE.Object3D();
  pitchObject.add(camera);

  yawObject = new THREE.Object3D();
  yawObject.position.set(0, playerHeight, 6);
  yawObject.add(pitchObject);
  scene.add(yawObject);

  renderer = new THREE.WebGLRenderer({ antialias: !isMobile });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.domElement.id = 'app-canvas';
  document.body.appendChild(renderer.domElement);

  buildLighting();
  buildRoom();
  buildShelvesAndBooks();
  buildTV();

  window.addEventListener('resize', onWindowResize);

  if (isMobile) {
    setupTouchControls();
  } else {
    setupDesktopControls();
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  glitchCanvas.width = window.innerWidth;
  glitchCanvas.height = window.innerHeight;
}

/* ==========================================================
   DESKTOP CONTROLS: KEYBOARD + POINTER LOCK MOUSE LOOK
   ========================================================== */

function setupDesktopControls() {
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  renderer.domElement.addEventListener('click', () => {
    if (gameStarted && !pointerLocked && !tvModal.classList.contains('visible')) {
      renderer.domElement.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    const shouldShowBlocker = gameStarted && !pointerLocked && !tvModal.classList.contains('visible');
    blockerMsg.style.display = shouldShowBlocker ? 'flex' : 'none';
  });

  document.addEventListener('mousemove', onMouseMove);

  blockerMsg.addEventListener('click', () => {
    renderer.domElement.requestPointerLock();
  });
}

function onMouseMove(e) {
  if (!pointerLocked) return;
  const sensitivity = 0.0022;
  yawObject.rotation.y -= e.movementX * sensitivity;
  pitchObject.rotation.x -= e.movementY * sensitivity;
  pitchObject.rotation.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitchObject.rotation.x));
}

function onKeyDown(e) {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': moveState.forward = true; break;
    case 'KeyS': case 'ArrowDown': moveState.backward = true; break;
    case 'KeyA': case 'ArrowLeft': moveState.left = true; break;
    case 'KeyD': case 'ArrowRight': moveState.right = true; break;
    case 'Space':
      e.preventDefault();
      triggerJump();
      break;
    case 'KeyE':
      if (tvNearPlayer && !tvModal.classList.contains('visible')) {
        openTVModal();
      }
      break;
  }
}

function onKeyUp(e) {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': moveState.forward = false; break;
    case 'KeyS': case 'ArrowDown': moveState.backward = false; break;
    case 'KeyA': case 'ArrowLeft': moveState.left = false; break;
    case 'KeyD': case 'ArrowRight': moveState.right = false; break;
  }
}

/* ==========================================================
   MOBILE CONTROLS: VIRTUAL JOYSTICK + TOUCH LOOK + BUTTONS
   ========================================================== */

let joystickActive = false;
let joystickTouchId = null;
let joystickOrigin = { x: 0, y: 0 };
const JOYSTICK_MAX_RADIUS = 50;

let lookTouchId = null;
let lastLookX = 0;
let lastLookY = 0;

function setupTouchControls() {
  joystickZone.addEventListener('touchstart', onJoystickStart, { passive: false });
  joystickZone.addEventListener('touchmove', onJoystickMove, { passive: false });
  joystickZone.addEventListener('touchend', onJoystickEnd, { passive: false });
  joystickZone.addEventListener('touchcancel', onJoystickEnd, { passive: false });

  lookZone.addEventListener('touchstart', onLookStart, { passive: false });
  lookZone.addEventListener('touchmove', onLookMove, { passive: false });
  lookZone.addEventListener('touchend', onLookEnd, { passive: false });
  lookZone.addEventListener('touchcancel', onLookEnd, { passive: false });

  mobileExitBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    exitToMenu();
  });

  jumpBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    triggerJump();
  }, { passive: false });

  tvInteractBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (tvNearPlayer) openTVModal();
  }, { passive: false });
}

function onJoystickStart(e) {
  e.preventDefault();
  if (joystickActive) return;
  const touch = e.changedTouches[0];
  joystickActive = true;
  joystickTouchId = touch.identifier;
  const rect = joystickBase.getBoundingClientRect();
  joystickOrigin.x = rect.left + rect.width / 2;
  joystickOrigin.y = rect.top + rect.height / 2;
  updateJoystickKnob(touch.clientX, touch.clientY);
}

function onJoystickMove(e) {
  e.preventDefault();
  for (const touch of e.changedTouches) {
    if (touch.identifier === joystickTouchId) {
      updateJoystickKnob(touch.clientX, touch.clientY);
    }
  }
}

function onJoystickEnd(e) {
  e.preventDefault();
  for (const touch of e.changedTouches) {
    if (touch.identifier === joystickTouchId) {
      joystickActive = false;
      joystickTouchId = null;
      joystickVector.x = 0;
      joystickVector.z = 0;
      joystickKnob.style.transform = 'translate(0px, 0px)';
    }
  }
}

function updateJoystickKnob(clientX, clientY) {
  let dx = clientX - joystickOrigin.x;
  let dy = clientY - joystickOrigin.y;
  const dist = Math.min(JOYSTICK_MAX_RADIUS, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx);
  const kx = Math.cos(angle) * dist;
  const ky = Math.sin(angle) * dist;
  joystickKnob.style.transform = `translate(${kx}px, ${ky}px)`;

  joystickVector.x = kx / JOYSTICK_MAX_RADIUS;
  joystickVector.z = -ky / JOYSTICK_MAX_RADIUS;
}

function onLookStart(e) {
  e.preventDefault();
  if (lookTouchId !== null) return;
  const touch = e.changedTouches[0];
  if (joystickActive && touch.identifier === joystickTouchId) return;
  lookTouchId = touch.identifier;
  lastLookX = touch.clientX;
  lastLookY = touch.clientY;
}

function onLookMove(e) {
  e.preventDefault();
  for (const touch of e.changedTouches) {
    if (touch.identifier === lookTouchId) {
      const dx = touch.clientX - lastLookX;
      const dy = touch.clientY - lastLookY;
      lastLookX = touch.clientX;
      lastLookY = touch.clientY;
      const sensitivity = 0.0042;
      yawObject.rotation.y -= dx * sensitivity;
      pitchObject.rotation.x -= dy * sensitivity;
      pitchObject.rotation.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitchObject.rotation.x));
    }
  }
}

function onLookEnd(e) {
  e.preventDefault();
  for (const touch of e.changedTouches) {
    if (touch.identifier === lookTouchId) {
      lookTouchId = null;
    }
  }
}

function exitToMenu() {
  gameStarted = false;
  hud.style.display = 'none';
  startOverlay.style.display = 'flex';
}

/* ==========================================================
   FULLSCREEN CONTROL
   ========================================================== */

function isCurrentlyFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
}

function requestFullscreenCompat(el) {
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
  if (el.msRequestFullscreen) return el.msRequestFullscreen();
  return Promise.reject(new Error('Fullscreen API unavailable'));
}

function exitFullscreenCompat() {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  if (document.msExitFullscreen) return document.msExitFullscreen();
  return Promise.reject(new Error('Fullscreen API unavailable'));
}

function updateFullscreenButtonVisibility() {
  fullscreenBtn.classList.toggle('hidden', isCurrentlyFullscreen());
}

function toggleFullscreen() {
  if (!isCurrentlyFullscreen()) {
    requestFullscreenCompat(document.documentElement).catch(() => {});
  } else {
    exitFullscreenCompat().catch(() => {});
  }
}

function setupFullscreenControl() {
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  fullscreenBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    toggleFullscreen();
  }, { passive: false });

  document.addEventListener('fullscreenchange', updateFullscreenButtonVisibility);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButtonVisibility);
  document.addEventListener('msfullscreenchange', updateFullscreenButtonVisibility);

  updateFullscreenButtonVisibility();
}

/* ==========================================================
   PROCEDURAL TEXTURES
   ========================================================== */

function makeWoodTexture(baseColor, grainColor, size) {
  size = size || 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = grainColor;
    ctx.globalAlpha = 0.08 + Math.random() * 0.12;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    const y = Math.random() * size;
    ctx.moveTo(0, y);
    let cy = y;
    for (let x = 0; x <= size; x += 16) {
      cy += (Math.random() - 0.5) * 10;
      ctx.lineTo(x, cy);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeStoneTexture(size) {
  size = size || 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3d3a35';
  ctx.fillRect(0, 0, size, size);
  const cols = 6, rows = 10;
  const cw = size / cols, ch = size / rows;
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const offset = (r % 2 === 0) ? 0 : cw / 2;
      const x = cIdx * cw + offset;
      const y = r * ch;
      const shade = 55 + Math.floor(Math.random() * 25);
      ctx.fillStyle = `rgb(${shade + 5}, ${shade}, ${shade - 8})`;
      ctx.fillRect(x + 2, y + 2, cw - 4, ch - 4);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeCarpetTexture(size) {
  size = size || 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5c1f22';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#7a2e2e';
  ctx.lineWidth = 6;
  ctx.strokeRect(20, 20, size - 40, size - 40);
  ctx.strokeStyle = '#c9a15a';
  ctx.lineWidth = 2;
  ctx.strokeRect(34, 34, size - 68, size - 68);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/* ==========================================================
   LIGHTING
   ========================================================== */

function buildLighting() {
  const ambient = new THREE.AmbientLight(0x554430, 0.55);
  scene.add(ambient);
  lights.ambient = ambient;

  const hemi = new THREE.HemisphereLight(0x8899aa, 0x332211, 0.35);
  scene.add(hemi);
  lights.hemi = hemi;

  const positions = [
    [-8, 4.2, -8], [8, 4.2, -8], [-8, 4.2, 8], [8, 4.2, 8], [0, 5, 0]
  ];
  lights.points = [];
  positions.forEach((p, idx) => {
    const pl = new THREE.PointLight(0xffcf8a, 1.1, 16, 2);
    pl.position.set(p[0], p[1], p[2]);
    pl.castShadow = idx < 3 && !isMobile;
    pl.shadow.mapSize.set(isMobile ? 512 : 1024, isMobile ? 512 : 1024);
    pl.shadow.bias = -0.002;
    scene.add(pl);

    const bulbGeo = new THREE.SphereGeometry(0.12, 12, 12);
    const bulbMat = new THREE.MeshStandardMaterial({ emissive: 0xffcf8a, emissiveIntensity: 2, color: 0x000000 });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.copy(pl.position);
    scene.add(bulb);

    lights.points.push({ light: pl, bulb: bulb, baseColor: new THREE.Color(0xffcf8a) });
  });
}

/* ==========================================================
   ROOM: FLOOR / WALLS / CEILING
   ========================================================== */

function buildRoom() {
  const size = worldHalfSize * 2;

  const floorTex = makeCarpetTexture();
  floorTex.repeat.set(8, 8);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9, metalness: 0.0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const ceilTex = makeWoodTexture('#2a1c10', '#1a1109');
  ceilTex.repeat.set(6, 6);
  const ceilMat = new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.85 });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(size, size), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 6.5;
  scene.add(ceiling);

  const wallTex = makeStoneTexture();
  wallTex.repeat.set(6, 2);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 });

  const wallDefs = [
    { pos: [0, 3.25, -worldHalfSize], rot: [0, 0, 0] },
    { pos: [0, 3.25, worldHalfSize], rot: [0, Math.PI, 0] },
    { pos: [-worldHalfSize, 3.25, 0], rot: [0, Math.PI / 2, 0] },
    { pos: [worldHalfSize, 3.25, 0], rot: [0, -Math.PI / 2, 0] },
  ];
  wallDefs.forEach(w => {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(size, 6.5), wallMat);
    wall.position.set(w.pos[0], w.pos[1], w.pos[2]);
    wall.rotation.set(w.rot[0], w.rot[1], w.rot[2]);
    wall.receiveShadow = true;
    scene.add(wall);
  });
}

/* ==========================================================
   SHELVES, BOOKS AND PICSUM FRAMES
   ========================================================== */

let pictureFrameId = 0;

function createFrameWithImage(width, height) {
  const group = new THREE.Group();

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a3216, roughness: 0.7 });
  const border = 0.06;

  const frameGeo = new THREE.BoxGeometry(width + border * 2, height + border * 2, 0.04);
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  frameMesh.castShadow = true;
  group.add(frameMesh);

  const placeholderMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
  const picGeo = new THREE.PlaneGeometry(width, height);
  const picMesh = new THREE.Mesh(picGeo, placeholderMat);
  picMesh.position.z = 0.025;
  group.add(picMesh);

  pictureFrameId++;
  const seed = pictureFrameId + Math.floor(Math.random() * 10000);
  const loader = new THREE.TextureLoader();
  loader.crossOrigin = 'anonymous';
  loader.load(
    `https://picsum.photos/400/300?random=${seed}`,
    (tex) => {
      tex.encoding = THREE.sRGBEncoding;
      picMesh.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
    },
    undefined,
    () => { /* keep placeholder on failure */ }
  );

  group.userData.isFrame = true;
  return group;
}

function createBookMesh(w, h, d) {
  const colors = [0x7a2e2e, 0x2e4a2e, 0x2e3a5a, 0x5a4a2e, 0x4a2e5a, 0x2e5a55, 0x6b3a1f];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildShelfUnit(x, z, rotationY, widthUnits) {
  const shelfGroup = new THREE.Group();
  shelfGroup.position.set(x, 0, z);
  shelfGroup.rotation.y = rotationY;

  const shelfWidth = widthUnits;
  const shelfDepth = 0.5;
  const shelfCount = 5;
  const shelfSpacing = 0.9;
  const woodTex = makeWoodTexture('#4a3018', '#2c1c0d');
  const frameMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.8 });

  const sideGeo = new THREE.BoxGeometry(0.08, shelfCount * shelfSpacing + 0.3, shelfDepth);
  [-shelfWidth / 2, shelfWidth / 2].forEach(sx => {
    const side = new THREE.Mesh(sideGeo, frameMat);
    side.position.set(sx, (shelfCount * shelfSpacing) / 2 + 0.1, 0);
    side.castShadow = true;
    side.receiveShadow = true;
    shelfGroup.add(side);
  });

  for (let i = 0; i <= shelfCount; i++) {
    const shelfGeo = new THREE.BoxGeometry(shelfWidth, 0.06, shelfDepth);
    const shelf = new THREE.Mesh(shelfGeo, frameMat);
    const y = i * shelfSpacing + 0.15;
    shelf.position.set(0, y, 0);
    shelf.castShadow = true;
    shelf.receiveShadow = true;
    shelfGroup.add(shelf);

    if (i < shelfCount) {
      const isPictureRow = (i % 2 === 0);
      if (isPictureRow && Math.random() < 0.6) {
        const fw = 0.7 + Math.random() * 0.3;
        const fh = 0.5 + Math.random() * 0.2;
        const frame = createFrameWithImage(fw, fh);
        frame.position.set((Math.random() - 0.5) * (shelfWidth - fw - 0.2), y + fh / 2 + 0.05, shelfDepth / 2 - 0.05);
        frame.userData.baseY = frame.position.y;
        frame.userData.baseRotZ = 0;
        frame.userData.animPhase = Math.random() * Math.PI * 2;
        shelfGroup.add(frame);
        animatedObjects.push(frame);
      } else {
        let cursor = -shelfWidth / 2 + 0.15;
        while (cursor < shelfWidth / 2 - 0.15) {
          const bw = 0.08 + Math.random() * 0.07;
          const bh = 0.55 + Math.random() * 0.3;
          const bd = shelfDepth - 0.1;
          const book = createBookMesh(bw, bh, bd);
          book.position.set(cursor + bw / 2, y + bh / 2 + 0.03, 0);
          book.rotation.z = (Math.random() - 0.5) * 0.05;
          book.userData.baseRotZ = book.rotation.z;
          book.userData.baseY = book.position.y;
          book.userData.animPhase = Math.random() * Math.PI * 2;
          book.userData.isBook = true;
          shelfGroup.add(book);
          if (Math.random() < 0.15) animatedObjects.push(book);
          cursor += bw + 0.02;
        }
      }
    }
  }

  scene.add(shelfGroup);
  return shelfGroup;
}

function buildShelvesAndBooks() {
  const offset = worldHalfSize - 0.6;

  buildShelfUnit(-offset, -4, Math.PI / 2, 5.5);
  buildShelfUnit(-offset, 4, Math.PI / 2, 5.5);
  buildShelfUnit(offset, -4, -Math.PI / 2, 5.5);
  buildShelfUnit(offset, 4, -Math.PI / 2, 5.5);

  buildShelfUnit(-4, -offset, 0, 5.5);
  buildShelfUnit(4, -offset, 0, 5.5);
  buildShelfUnit(-4, offset, Math.PI, 5.5);
  buildShelfUnit(4, offset, Math.PI, 5.5);

  buildShelfUnit(-6, -1, Math.PI / 2, 4);
  buildShelfUnit(-6, 4.5, Math.PI / 2, 4);
  buildShelfUnit(6, -1, -Math.PI / 2, 4);
  buildShelfUnit(6, 4.5, -Math.PI / 2, 4);

  const readingTableMat = new THREE.MeshStandardMaterial({ map: makeWoodTexture('#5a3c1e', '#33210f'), roughness: 0.7 });
  const table = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 1.1), readingTableMat);
  table.position.set(0, 0.75, 2.5);
  table.castShadow = true;
  table.receiveShadow = true;
  scene.add(table);

  const legGeo = new THREE.BoxGeometry(0.08, 0.75, 0.08);
  [[-1.1, -0.45], [1.1, -0.45], [-1.1, 0.45], [1.1, 0.45]].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(legGeo, readingTableMat);
    leg.position.set(lx, 0.375, lz + 2.5);
    leg.castShadow = true;
    scene.add(leg);
  });
}

/* ==========================================================
   SMART TV
   ========================================================== */

function buildTV() {
  tvGroup = new THREE.Group();
  tvGroup.position.set(0, 0, -3.6);
  tvGroup.rotation.y = 0;

  const metalMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.35, metalness: 0.75 });

  const baseGeo = new THREE.BoxGeometry(0.7, 0.04, 0.3);
  const base = new THREE.Mesh(baseGeo, metalMat);
  base.position.set(0, 0.02, 0);
  base.castShadow = true;
  base.receiveShadow = true;
  tvGroup.add(base);

  const neckGeo = new THREE.BoxGeometry(0.08, 0.9, 0.06);
  const neck = new THREE.Mesh(neckGeo, metalMat);
  neck.position.set(0, 0.5, 0);
  neck.castShadow = true;
  tvGroup.add(neck);

  const bezelGeo = new THREE.BoxGeometry(tvScreenWidth + 0.05, tvScreenHeight + 0.05, 0.045);
  const bezel = new THREE.Mesh(bezelGeo, metalMat);
  bezel.position.set(0, 1.28, 0);
  bezel.castShadow = true;
  tvGroup.add(bezel);

  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x030303,
    emissive: 0x0c1220,
    emissiveIntensity: 0.4,
    roughness: 0.2,
    metalness: 0.1
  });
  const screenGeo = new THREE.PlaneGeometry(tvScreenWidth, tvScreenHeight);
  tvScreenMesh = new THREE.Mesh(screenGeo, screenMat);
  tvScreenMesh.position.set(0, 1.28, 0.024);
  tvGroup.add(tvScreenMesh);

  const ledGeo = new THREE.SphereGeometry(0.012, 8, 8);
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x2ecc55, emissiveIntensity: 1.5 });
  const led = new THREE.Mesh(ledGeo, ledMat);
  led.position.set(0, 1.28 - tvScreenHeight / 2 - 0.02, 0.03);
  tvGroup.add(led);

  scene.add(tvGroup);
}

function updateTVInteraction() {
  camera.updateMatrixWorld(true);
  const camPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  camera.getWorldPosition(camPos);
  camera.getWorldDirection(camDir);
  raycaster.set(camPos, camDir);

  const hits = raycaster.intersectObject(tvScreenMesh, false);
  const near = hits.length > 0 && hits[0].distance < 4.5;

  if (near !== tvNearPlayer) {
    tvNearPlayer = near;
    if (!isMobile) {
      interactPrompt.classList.toggle('visible', near && !tvModal.classList.contains('visible'));
    } else {
      tvInteractBtn.classList.toggle('visible', near);
    }
  }
}

function worldToScreenPoint(vec3) {
  const p = vec3.clone().project(camera);
  const halfW = window.innerWidth / 2;
  const halfH = window.innerHeight / 2;
  return {
    x: p.x * halfW + halfW,
    y: -p.y * halfH + halfH,
    behind: p.z > 1 || p.z < -1
  };
}

function updateTVOverlayPosition() {
  if (!tvActive) {
    tvScreenOverlay.style.display = 'none';
    return;
  }
  if (currentPhase === 3) {
    tvScreenOverlay.style.display = 'none';
    return;
  }

  const hw = tvScreenWidth / 2;
  const hh = tvScreenHeight / 2;
  const corners = [
    new THREE.Vector3(-hw, hh, 0),
    new THREE.Vector3(hw, hh, 0),
    new THREE.Vector3(-hw, -hh, 0),
    new THREE.Vector3(hw, -hh, 0)
  ].map(c => tvScreenMesh.localToWorld(c.clone()));

  const projected = corners.map(worldToScreenPoint);
  if (projected.some(p => p.behind)) {
    tvScreenOverlay.style.display = 'none';
    return;
  }

  const xs = projected.map(p => p.x);
  const ys = projected.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX;
  const h = maxY - minY;

  if (w < 4 || h < 4 || minX > window.innerWidth || maxX < 0 || minY > window.innerHeight || maxY < 0) {
    tvScreenOverlay.style.display = 'none';
    return;
  }

  tvScreenOverlay.style.display = 'block';
  tvScreenOverlay.style.left = minX + 'px';
  tvScreenOverlay.style.top = minY + 'px';
  tvScreenOverlay.style.width = w + 'px';
  tvScreenOverlay.style.height = h + 'px';
}

/* ---------------------- TV modal & video loading ---------------------- */

function openTVModal() {
  tvError.textContent = '';
  tvModal.classList.add('visible');
  if (!isMobile && pointerLocked) {
    document.exitPointerLock();
  }
}

function closeTVModal() {
  tvModal.classList.remove('visible');
  if (!isMobile && gameStarted) {
    renderer.domElement.requestPointerLock();
  }
}

function extractYouTubeId(url) {
  const patterns = [
    /youtube\.com\/watch\?[^#]*v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /youtube\.com\/embed\/([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractRutubeId(url) {
  const m = url.match(/rutube\.ru\/(?:video|play\/embed)\/([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

function extractDzenId(url) {
  const m = url.match(/dzen\.ru\/(?:video\/watch|embed)\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function clearTVPlayer() {
  if (ytPlayer) {
    try { ytPlayer.destroy(); } catch (e) {}
    ytPlayer = null;
  }
  tvScreenOverlay.innerHTML = '';
  tvUsingGenericIframe = false;
}

function handleTVPlayRequest() {
  const url = tvUrlInput.value.trim();
  tvError.textContent = '';
  tvNote.textContent = '';

  if (!url) {
    tvError.textContent = 'Вставьте ссылку на видео';
    return;
  }

  const ytId = extractYouTubeId(url);
  if (ytId) {
    loadYouTubeVideo(ytId);
    return;
  }

  const rtId = extractRutubeId(url);
  if (rtId) {
    loadGenericIframe(
      `https://rutube.ru/play/embed/${rtId}`,
      'Rutube не предоставляет публичный API для смены качества — воспроизведение в автоматическом качестве, выбранном плеером.'
    );
    return;
  }

  const dzId = extractDzenId(url);
  if (dzId) {
    loadGenericIframe(
      `https://dzen.ru/embed/${dzId}`,
      'Дзен не предоставляет публичный API для смены качества — воспроизведение в автоматическом качестве, выбранном плеером.'
    );
    return;
  }

  tvError.textContent = 'Не удалось распознать ссылку. Поддерживаются YouTube, Rutube и Дзен.';
}

function activateTVScreen() {
  tvActive = true;
  tvScreenMesh.visible = false;
}

function loadYouTubeVideo(videoId) {
  clearTVPlayer();
  activateTVScreen();

  tvQualitySelect.disabled = true;
  tvQualitySelect.innerHTML = '<option value="auto">Загрузка...</option>';

  const playerDiv = document.createElement('div');
  playerDiv.id = 'yt-player-slot-' + Date.now();
  playerDiv.style.width = '100%';
  playerDiv.style.height = '100%';
  tvScreenOverlay.appendChild(playerDiv);

  if (window.YT && window.YT.Player) {
    createYTPlayer(videoId, playerDiv.id);
  } else {
    pendingYouTubeLoad = { videoId, divId: playerDiv.id };
    tvNote.textContent = 'Загружается плеер YouTube...';
  }
}

function createYTPlayer(videoId, divId) {
  ytPlayer = new YT.Player(divId, {
    videoId: videoId,
    width: '100%',
    height: '100%',
    playerVars: {
      autoplay: 1,
      controls: 0,
      disablekb: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1
    },
    events: {
      onReady: (e) => {
        e.target.playVideo();
        populateQualityOptions(e.target);
        tvNote.textContent = 'Видео воспроизводится на экране в библиотеке.';
      },
      onError: () => {
        tvError.textContent = 'Не удалось загрузить это видео YouTube. Проверьте ссылку.';
      }
    }
  });
}

function populateQualityOptions(player) {
  let levels = [];
  try { levels = player.getAvailableQualityLevels() || []; } catch (e) { levels = []; }

  const labels = {
    hd2160: '4K (2160p)',
    hd1440: '1440p',
    hd1080: '1080p',
    hd720: '720p',
    large: '480p',
    medium: '360p',
    small: '240p',
    tiny: '144p',
    auto: 'Автоматически'
  };

  tvQualitySelect.innerHTML = '';
  const autoOpt = document.createElement('option');
  autoOpt.value = 'auto';
  autoOpt.textContent = 'Автоматически';
  tvQualitySelect.appendChild(autoOpt);

  if (levels.length) {
    levels.forEach(level => {
      const opt = document.createElement('option');
      opt.value = level;
      opt.textContent = labels[level] || level;
      tvQualitySelect.appendChild(opt);
    });
    tvQualitySelect.disabled = false;
    tvNote.textContent = 'Качество можно менять вручную (YouTube может переопределить выбор в зависимости от скорости соединения).';
  } else {
    tvQualitySelect.disabled = true;
    tvNote.textContent = 'YouTube не предоставил список доступных вариантов качества для этого видео — используется автоматический режим.';
  }
}

tvQualitySelect.addEventListener('change', () => {
  if (ytPlayer && typeof ytPlayer.setPlaybackQuality === 'function') {
    ytPlayer.setPlaybackQuality(tvQualitySelect.value);
  }
});

function loadGenericIframe(src, note) {
  clearTVPlayer();
  activateTVScreen();
  tvUsingGenericIframe = true;

  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.setAttribute('allow', 'autoplay; fullscreen');
  iframe.setAttribute('allowfullscreen', 'true');
  tvScreenOverlay.appendChild(iframe);

  tvQualitySelect.innerHTML = '<option value="auto">Недоступно для этой платформы</option>';
  tvQualitySelect.disabled = true;
  tvNote.textContent = note;
}

function stopTV() {
  clearTVPlayer();
  tvActive = false;
  tvScreenMesh.visible = true;
  tvScreenOverlay.style.display = 'none';
  tvUrlInput.value = '';
  tvQualitySelect.innerHTML = '<option value="auto">Автоматически</option>';
  tvQualitySelect.disabled = true;
  tvError.textContent = '';
  tvNote.textContent = '';
}

window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  if (pendingYouTubeLoad) {
    createYTPlayer(pendingYouTubeLoad.videoId, pendingYouTubeLoad.divId);
    pendingYouTubeLoad = null;
  }
};

tvPlayBtn.addEventListener('click', handleTVPlayRequest);
tvStopBtn.addEventListener('click', stopTV);
tvCloseBtn.addEventListener('click', closeTVModal);
tvUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleTVPlayRequest();
});

/* ==========================================================
   MOVEMENT (UNIFIED: KEYBOARD + JOYSTICK) + JUMP
   ========================================================== */

function getMoveInput() {
  let x = joystickVector.x;
  let z = joystickVector.z;
  if (moveState.forward) z += 1;
  if (moveState.backward) z -= 1;
  if (moveState.right) x += 1;
  if (moveState.left) x -= 1;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  return { x, z };
}

function updateMovement(delta) {
  const input = getMoveInput();
  if (input.x === 0 && input.z === 0) return;

  const speed = 4.2;
  const yaw = yawObject.rotation.y;

  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  const moveX = (forwardX * input.z + rightX * input.x) * speed * delta;
  const moveZ = (forwardZ * input.z + rightZ * input.x) * speed * delta;

  yawObject.position.x += moveX;
  yawObject.position.z += moveZ;

  const limit = worldHalfSize - 0.8;
  yawObject.position.x = Math.max(-limit, Math.min(limit, yawObject.position.x));
  yawObject.position.z = Math.max(-limit, Math.min(limit, yawObject.position.z));
}

function triggerJump() {
  if (isGrounded && gameStarted && !tvModal.classList.contains('visible')) {
    verticalVelocity = JUMP_SPEED;
    isGrounded = false;
  }
}

function updateVerticalPhysics(delta) {
  if (!isGrounded) {
    verticalVelocity += GRAVITY * delta;
    yawObject.position.y += verticalVelocity * delta;
  }
  if (yawObject.position.y <= playerHeight) {
    yawObject.position.y = playerHeight;
    verticalVelocity = 0;
    isGrounded = true;
  }
}

/* ==========================================================
   SIGNALING (MQTT presence broadcast + direct invite-link fallback)
   ========================================================== */

function initMultiplayer() {
  connectionStatus.textContent = 'Подключение к сети...';

  myPeer = new Peer(undefined, {
    host: '0.peerjs.com',
    port: 443,
    secure: true,
    path: '/',
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  });

  myPeer.on('open', (id) => {
    myPeerId = id;
    connectionStatus.textContent = 'Подключено. Ваш ID: ' + id.substring(0, 8) + '...';
    setupInviteLink(id);
    connectSignaling();
    tryConnectFromInviteParam();
  });

  myPeer.on('connection', (conn) => {
    setupConnection(conn);
  });

  myPeer.on('error', (err) => {
    console.warn('PeerJS error:', err);
    connectionStatus.textContent = 'Ошибка PeerJS: ' + (err && err.type ? err.type : 'неизвестна');
  });
}

function setupInviteLink(id) {
  const url = new URL(window.location.href);
  url.searchParams.set('peer', id);
  inviteLinkInput.value = url.toString();
}

function tryConnectFromInviteParam() {
  const params = new URLSearchParams(window.location.search);
  const targetId = params.get('peer');
  if (targetId && targetId !== myPeerId && !connections[targetId]) {
    const conn = myPeer.connect(targetId, { reliable: true, metadata: { nickname: nickname } });
    setupConnection(conn);
  }
}

function connectSignaling() {
  try {
    const shortId = myPeerId.substring(0, 12).replace(/[^a-zA-Z0-9]/g, '');
    mqttClient = mqtt.connect(MQTT_BROKER_URL, {
      clientId: 'lib3d' + shortId + Math.floor(Math.random() * 1000),
      clean: true,
      reconnectPeriod: 4000,
      connectTimeout: 10000
    });

    mqttClient.on('connect', () => {
      connectionStatus.textContent = 'Сеть активна. Ваш ID: ' + myPeerId.substring(0, 8) + '...';
      mqttClient.subscribe(PRESENCE_TOPIC);
      publishPresence();

      if (!signalReady) {
        signalReady = true;
        setInterval(publishPresence, 3000);
        setInterval(prunePeers, 4000);
      }
    });

    mqttClient.on('reconnect', () => {
      connectionStatus.textContent = 'Переподключение к сети...';
    });

    mqttClient.on('message', (topic, payload) => {
      if (topic !== PRESENCE_TOPIC) return;
      try {
        const msg = JSON.parse(payload.toString());
        handlePresenceMessage(msg);
      } catch (e) { /* ignore malformed */ }
    });

    mqttClient.on('error', (err) => {
      console.warn('MQTT signaling error:', err);
      connectionStatus.textContent = 'Общий сервер недоступен. Используйте ссылку-приглашение ниже.';
    });
  } catch (e) {
    console.warn('MQTT unavailable:', e);
    connectionStatus.textContent = 'Мультиплеер через общий сервер недоступен. Используйте ссылку-приглашение.';
  }
}

function publishPresence() {
  if (!mqttClient || !mqttClient.connected || !myPeerId) return;
  const payload = JSON.stringify({ peerId: myPeerId, nickname: nickname, ts: Date.now() });
  mqttClient.publish(PRESENCE_TOPIC, payload);
}

function handlePresenceMessage(msg) {
  if (!msg.peerId || msg.peerId === myPeerId) return;

  lastSeenPeers[msg.peerId] = Date.now();

  if (!connections[msg.peerId]) {
    if (myPeerId < msg.peerId) {
      const conn = myPeer.connect(msg.peerId, { reliable: true, metadata: { nickname: nickname } });
      setupConnection(conn);
    }
  }

  ensureRemotePlayer(msg.peerId, msg.nickname);
  updatePlayersCount();
}

function prunePeers() {
  const now = Date.now();
  Object.keys(lastSeenPeers).forEach(peerId => {
    if (now - lastSeenPeers[peerId] > 12000) {
      delete lastSeenPeers[peerId];
      removeRemotePlayer(peerId);
      if (connections[peerId]) {
        try { connections[peerId].close(); } catch (e) {}
        delete connections[peerId];
      }
      updatePlayersCount();
    }
  });
}

/* ==========================================================
   PEERJS DATA CHANNELS
   ========================================================== */

function setupConnection(conn) {
  connections[conn.peer] = conn;

  conn.on('open', () => {
    conn.send({ type: 'hello', nickname: nickname });
    lastSeenPeers[conn.peer] = Date.now();
    updatePlayersCount();
  });

  conn.on('data', (data) => {
    lastSeenPeers[conn.peer] = Date.now();
    handlePeerData(conn.peer, data);
  });

  conn.on('close', () => {
    removeRemotePlayer(conn.peer);
    delete connections[conn.peer];
    updatePlayersCount();
  });

  conn.on('error', () => {
    removeRemotePlayer(conn.peer);
    delete connections[conn.peer];
    updatePlayersCount();
  });
}

function handlePeerData(peerId, data) {
  if (!data || !data.type) return;

  if (data.type === 'hello') {
    ensureRemotePlayer(peerId, data.nickname);
    updatePlayersCount();
  } else if (data.type === 'pose') {
    ensureRemotePlayer(peerId, data.nickname);
    const rp = remotePlayers[peerId];
    if (rp) {
      rp.targetPos.set(data.x, data.y, data.z);
      rp.targetRotY = data.rotY;
    }
  }
}

function makeNicknameSprite(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(10, 8, 5, 0.55)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.font = 'bold 32px Georgia';
  ctx.fillStyle = '#f0e6c8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.substring(0, 16), c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.2, 0.3, 1);
  sprite.position.y = 2.05;
  return sprite;
}

function ensureRemotePlayer(peerId, nick) {
  if (remotePlayers[peerId]) {
    if (nick && remotePlayers[peerId].nickname !== nick) {
      remotePlayers[peerId].nickname = nick;
    }
    return;
  }

  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 4, 8), bodyMat);
  body.position.y = 0.9;
  body.castShadow = true;
  group.add(body);

  const headMat = new THREE.MeshStandardMaterial({ color: 0xe0b98f, roughness: 0.6 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), headMat);
  head.position.y = 1.65;
  head.castShadow = true;
  group.add(head);

  const sprite = makeNicknameSprite(nick || 'Гость');
  group.add(sprite);

  group.position.set(0, playerHeight, 0);
  scene.add(group);

  remotePlayers[peerId] = {
    group,
    nickname: nick || 'Гость',
    targetPos: new THREE.Vector3(0, playerHeight, 0),
    targetRotY: 0
  };
}

function removeRemotePlayer(peerId) {
  const rp = remotePlayers[peerId];
  if (rp) {
    scene.remove(rp.group);
    delete remotePlayers[peerId];
  }
}

function broadcastPose() {
  if (!myPeer || !myPeerId) return;
  const payload = {
    type: 'pose',
    nickname: nickname,
    x: yawObject.position.x,
    y: yawObject.position.y,
    z: yawObject.position.z,
    rotY: yawObject.rotation.y
  };
  Object.values(connections).forEach(conn => {
    if (conn.open) conn.send(payload);
  });
}

function updateRemotePlayers(delta) {
  Object.values(remotePlayers).forEach(rp => {
    rp.group.position.lerp(rp.targetPos, Math.min(1, delta * 8));
    let dy = rp.targetRotY - rp.group.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    rp.group.rotation.y += dy * Math.min(1, delta * 8);
  });
}

function updatePlayersCount() {
  playersCount.textContent = Object.keys(remotePlayers).length + 1;
}

/* ==========================================================
   TIMER & PHASES
   ========================================================== */

function formatTime(t) {
  const m = Math.floor(t / 60).toString().padStart(2, '0');
  const s = Math.floor(t % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function updateTimer(delta) {
  if (timerFrozen) return;

  elapsedTime += delta;
  timerValue.textContent = formatTime(elapsedTime);

  if (elapsedTime < PHASE1_END) {
    currentPhase = 1;
  } else if (elapsedTime < PHASE2_END) {
    currentPhase = 2;
  } else if (elapsedTime < PHASE3_END) {
    currentPhase = 3;
    if (!glitchTriggered) {
      glitchTriggered = true;
      triggerGlitchApocalypse();
    }
  } else {
    if (currentPhase === 3) {
      endGlitchApocalypse();
    }
    currentPhase = 4;
  }
}

/* ---------------------- Phase 2: strange bugs ---------------------- */

function applyPhase2Effects(t) {
  const progress = Math.min(1, (elapsedTime - PHASE1_END) / (PHASE2_END - PHASE1_END));
  const intensity = progress;

  animatedObjects.forEach(obj => {
    const phase = obj.userData.animPhase || 0;
    const baseY = obj.userData.baseY !== undefined ? obj.userData.baseY : obj.position.y;
    const baseRotZ = obj.userData.baseRotZ || 0;

    if (Math.random() < 0.002 * intensity) {
      obj.userData.levitate = !obj.userData.levitate;
    }

    const wobble = Math.sin(t * 3 + phase) * 0.02 * intensity;
    const spin = Math.sin(t * 5 + phase) * 0.15 * intensity;

    if (obj.userData.levitate) {
      obj.position.y = baseY + 0.3 * intensity + Math.sin(t * 2 + phase) * 0.05;
    } else {
      obj.position.y = baseY + wobble;
    }
    obj.rotation.z = baseRotZ + spin;
    if (obj.userData.isFrame) {
      obj.rotation.y = Math.sin(t * 2 + phase) * 0.3 * intensity;
    }
  });

  lights.points.forEach((entry) => {
    if (Math.random() < 0.01 * intensity) {
      const shiftedHue = Math.random();
      const c = new THREE.Color();
      c.setHSL(shiftedHue, 0.8, 0.6);
      entry.light.color = c;
      entry.bulb.material.emissive = c;
    } else if (Math.random() < 0.01 * intensity) {
      entry.light.color.copy(entry.baseColor);
      entry.bulb.material.emissive = entry.baseColor;
    }
  });
}

function resetAnimatedObjects() {
  animatedObjects.forEach(obj => {
    const baseY = obj.userData.baseY !== undefined ? obj.userData.baseY : obj.position.y;
    const baseRotZ = obj.userData.baseRotZ || 0;
    obj.position.y = baseY;
    obj.rotation.z = baseRotZ;
    obj.rotation.y = 0;
    obj.userData.levitate = false;
  });
  lights.points.forEach(entry => {
    entry.light.color.copy(entry.baseColor);
    entry.bulb.material.emissive = entry.baseColor;
  });
}

/* ---------------------- Phase 3: glitch apocalypse ---------------------- */

function triggerGlitchApocalypse() {
  glitchCanvas.style.display = 'block';
  glitchCanvas.width = window.innerWidth;
  glitchCanvas.height = window.innerHeight;
  playGlitchNoise();
}

function endGlitchApocalypse() {
  glitchCanvas.style.display = 'none';
  glitchCtx.clearRect(0, 0, glitchCanvas.width, glitchCanvas.height);
  resetAnimatedObjects();
  stopGlitchNoise();
}

function renderGlitchOverlay() {
  const w = glitchCanvas.width;
  const h = glitchCanvas.height;
  glitchCtx.clearRect(0, 0, w, h);

  glitchCtx.fillStyle = `rgba(${Math.random() * 255 | 0}, 0, ${Math.random() * 255 | 0}, 0.15)`;
  glitchCtx.fillRect(0, 0, w, h);

  const sliceCount = 24;
  for (let i = 0; i < sliceCount; i++) {
    const y = Math.random() * h;
    const sh = Math.random() * 30 + 2;
    const dx = (Math.random() - 0.5) * 60;
    glitchCtx.save();
    glitchCtx.translate(dx, 0);
    glitchCtx.fillStyle = `rgba(${Math.random() * 255 | 0}, ${Math.random() * 255 | 0}, ${Math.random() * 255 | 0}, 0.25)`;
    glitchCtx.fillRect(0, y, w, sh);
    glitchCtx.restore();
  }

  glitchCtx.globalCompositeOperation = 'difference';
  glitchCtx.fillStyle = 'rgba(255,255,255,0.06)';
  glitchCtx.fillRect(0, 0, w, h);
  glitchCtx.globalCompositeOperation = 'source-over';

  for (let i = 0; i < 400; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const b = Math.random() * 255 | 0;
    glitchCtx.fillStyle = `rgba(${b},${b},${b},0.5)`;
    glitchCtx.fillRect(x, y, 2, 2);
  }

  if (Math.random() < 0.1) {
    glitchCtx.fillStyle = 'rgba(255,255,255,0.9)';
    glitchCtx.fillRect(0, 0, w, h);
  }
}

/* ---------------------- Web Audio glitch noise ---------------------- */

function playGlitchNoise() {
  try {
    glitchAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = glitchAudioCtx;
    const bufferSize = ctx.sampleRate * 5;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (0.4 + 0.3 * Math.sin(i * 0.001));
    }
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200;
    filter.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.value = 0.35;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 400;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noiseSource.start();

    glitchAudioCtx._nodes = { noiseSource, lfo, gain };

    setTimeout(() => {
      try {
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
      } catch (e) {}
    }, 4700);
  } catch (e) {
    console.warn('Web Audio unavailable:', e);
  }
}

function stopGlitchNoise() {
  if (glitchAudioCtx) {
    try {
      const nodes = glitchAudioCtx._nodes;
      if (nodes) {
        nodes.noiseSource.stop();
        nodes.lfo.stop();
      }
      glitchAudioCtx.close();
    } catch (e) {}
    glitchAudioCtx = null;
  }
}

/* ==========================================================
   MAIN LOOP
   ========================================================== */

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(0.1, clock.getDelta());
  const t = clock.elapsedTime;

  if (gameStarted) {
    const controlsActive = (isMobile || pointerLocked) && !tvModal.classList.contains('visible');
    if (controlsActive) {
      updateMovement(delta);
    }
    updateVerticalPhysics(delta);
    updateTimer(delta);
    updateTVInteraction();
    updateTVOverlayPosition();

    if (currentPhase === 2) {
      applyPhase2Effects(t);
    } else if (currentPhase === 3) {
      renderGlitchOverlay();
    }

    lights.points.forEach(entry => {
      entry.bulb.position.copy(entry.light.position);
    });

    broadcastPoseThrottled(delta);
    updateRemotePlayers(delta);
  }

  renderer.render(scene, camera);
}

let poseAccumulator = 0;
function broadcastPoseThrottled(delta) {
  poseAccumulator += delta;
  if (poseAccumulator > 0.08) {
    poseAccumulator = 0;
    broadcastPose();
  }
}

/* ==========================================================
   START FLOW
   ========================================================== */

function startGame() {
  const value = nicknameInput.value.trim();
  if (!value) {
    startError.textContent = 'Пожалуйста, введите никнейм';
    return;
  }
  nickname = value;
  startError.textContent = '';

  startOverlay.style.display = 'none';
  hud.style.display = 'block';

  gameStarted = true;
  clock.start();

  if (!isMobile) {
    renderer.domElement.requestPointerLock();
  }

  if (!myPeer) {
    initMultiplayer();
  } else if (mqttClient) {
    publishPresence();
  }
}

startBtn.addEventListener('click', startGame);
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startGame();
});

inviteCopyBtn.addEventListener('click', () => {
  inviteLinkInput.select();
  try {
    navigator.clipboard.writeText(inviteLinkInput.value);
    inviteCopyBtn.textContent = 'Скопировано!';
    setTimeout(() => { inviteCopyBtn.textContent = 'Копировать'; }, 1500);
  } catch (e) {
    document.execCommand('copy');
  }
});

/* ==========================================================
   BOOTSTRAP
   ========================================================== */

initScene();
setupFullscreenControl();
onWindowResize();
animate();

/* Begin peer/signaling setup immediately so the invite link and
   your own ID are available even before pressing "start". */
initMultiplayer();
