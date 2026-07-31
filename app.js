/* ==========================================================
   3D LIBRARY — FPS + PeerJS MULTIPLAYER + GLITCH TIMELINE
   ========================================================== */

/* ---------------------- Global State ---------------------- */

let scene, camera, renderer, controls;
let clock = new THREE.Clock();
let raycaster = new THREE.Raycaster();

const moveState = { forward: false, backward: false, left: false, right: false };
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

let playerHeight = 1.7;
let playerRadius = 0.35;
let worldHalfSize = 14;

let nickname = "";
let myPeer = null;
let myPeerId = null;
let connections = {};
let remotePlayers = {};

let animatedObjects = [];
let lights = {};

let gameStarted = false;
let elapsedTime = 0;

const PHASE1_END = 60;
const PHASE2_END = 90;
const PHASE3_END = 95;

let currentPhase = 1;
let glitchTriggered = false;
let glitchAudioCtx = null;

/* ---------------------- DOM References ---------------------- */

const startOverlay = document.getElementById('start-overlay');
const nicknameInput = document.getElementById('nickname-input');
const startBtn = document.getElementById('start-btn');
const startError = document.getElementById('start-error');
const hud = document.getElementById('hud');
const timerValue = document.getElementById('timer-value');
const playersCount = document.getElementById('players-count');
const blockerMsg = document.getElementById('blocker-msg');
const glitchCanvas = document.getElementById('glitch-canvas');
const glitchCtx = glitchCanvas.getContext('2d');

/* ==========================================================
   INITIALIZATION
   ========================================================== */

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0906);
  scene.fog = new THREE.FogExp2(0x0b0906, 0.028);

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, playerHeight, 6);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.domElement.id = 'app-canvas';
  document.body.appendChild(renderer.domElement);

  controls = new THREE.PointerLockControls(camera, renderer.domElement);
  scene.add(controls.getObject());

  buildLighting();
  buildRoom();
  buildShelvesAndBooks();

  window.addEventListener('resize', onWindowResize);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  renderer.domElement.addEventListener('click', () => {
    if (gameStarted) controls.lock();
  });

  controls.addEventListener('lock', () => { blockerMsg.style.display = 'none'; });
  controls.addEventListener('unlock', () => {
    if (gameStarted) blockerMsg.style.display = 'flex';
  });

  blockerMsg.addEventListener('click', () => controls.lock());
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  glitchCanvas.width = window.innerWidth;
  glitchCanvas.height = window.innerHeight;
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
    pl.castShadow = idx < 3;
    pl.shadow.mapSize.set(1024, 1024);
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
  table.position.set(0, 0.75, 0);
  table.castShadow = true;
  table.receiveShadow = true;
  scene.add(table);

  const legGeo = new THREE.BoxGeometry(0.08, 0.75, 0.08);
  [[-1.1, -0.45], [1.1, -0.45], [-1.1, 0.45], [1.1, 0.45]].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(legGeo, readingTableMat);
    leg.position.set(lx, 0.375, lz);
    leg.castShadow = true;
    scene.add(leg);
  });
}

/* ==========================================================
   MOVEMENT & COLLISION
   ========================================================== */

function onKeyDown(e) {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': moveState.forward = true; break;
    case 'KeyS': case 'ArrowDown': moveState.backward = true; break;
    case 'KeyA': case 'ArrowLeft': moveState.left = true; break;
    case 'KeyD': case 'ArrowRight': moveState.right = true; break;
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

function updateMovement(delta) {
  const speed = 6.0;
  velocity.x -= velocity.x * 10.0 * delta;
  velocity.z -= velocity.z * 10.0 * delta;

  direction.z = Number(moveState.forward) - Number(moveState.backward);
  direction.x = Number(moveState.right) - Number(moveState.left);
  direction.normalize();

  if (moveState.forward || moveState.backward) velocity.z -= direction.z * speed * delta * 10;
  if (moveState.left || moveState.right) velocity.x -= direction.x * speed * delta * 10;

  const obj = controls.getObject();
  const prevX = obj.position.x;
  const prevZ = obj.position.z;

  controls.moveRight(-velocity.x * delta);
  controls.moveForward(-velocity.z * delta);

  const limit = worldHalfSize - 0.8;
  if (obj.position.x > limit) obj.position.x = limit;
  if (obj.position.x < -limit) obj.position.x = -limit;
  if (obj.position.z > limit) obj.position.z = limit;
  if (obj.position.z < -limit) obj.position.z = -limit;

  obj.position.y = playerHeight;
}

/* ==========================================================
   PEERJS MULTIPLAYER
   ========================================================== */

function initMultiplayer() {
  myPeer = new Peer(undefined, {
    host: '0.peerjs.com',
    port: 443,
    secure: true,
    path: '/'
  });

  myPeer.on('open', (id) => {
    myPeerId = id;
    announcePresence();
  });

  myPeer.on('connection', (conn) => {
    setupConnection(conn);
  });

  myPeer.on('error', (err) => {
    console.warn('PeerJS error:', err);
  });
}

function announcePresence() {
  const registryKey = 'library_peers_registry';
  let registry = [];
  try {
    registry = JSON.parse(localStorage.getItem(registryKey) || '[]');
  } catch (e) { registry = []; }

  registry = registry.filter(id => id !== myPeerId);

  registry.forEach(peerId => {
    try {
      const conn = myPeer.connect(peerId, { reliable: true });
      setupConnection(conn);
    } catch (e) { /* ignore unreachable peers */ }
  });

  registry.push(myPeerId);
  registry = registry.slice(-20);
  localStorage.setItem(registryKey, JSON.stringify(registry));
}

function setupConnection(conn) {
  connections[conn.peer] = conn;

  conn.on('open', () => {
    conn.send({ type: 'hello', nickname: nickname });
    updatePlayersCount();
  });

  conn.on('data', (data) => {
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
  if (remotePlayers[peerId]) return;

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

  scene.add(group);

  remotePlayers[peerId] = {
    group,
    nickname: nick || 'Гость',
    targetPos: new THREE.Vector3(0, 0, 0),
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
  const obj = controls.getObject();
  const payload = {
    type: 'pose',
    nickname: nickname,
    x: obj.position.x,
    y: obj.position.y,
    z: obj.position.z,
    rotY: camera.rotation.y
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
    if (elapsedTime > PHASE3_END + 0.5) {
      resetTimerCycle();
    }
  }
}

function resetTimerCycle() {
  elapsedTime = 0;
  currentPhase = 1;
  glitchTriggered = false;
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

  lights.points.forEach((entry, idx) => {
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
    if (controls.isLocked) {
      updateMovement(delta);
    }
    updateTimer(delta);

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

  startOverlay.style.display = 'none';
  hud.style.display = 'block';

  gameStarted = true;
  clock.start();
  controls.lock();

  initMultiplayer();
}

startBtn.addEventListener('click', startGame);
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startGame();
});

/* ==========================================================
   BOOTSTRAP
   ========================================================== */

initScene();
onWindowResize();
animate();
