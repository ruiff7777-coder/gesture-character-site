const app = document.querySelector('#app')
const stateEyebrow = document.querySelector('#state-eyebrow')
const stateTitle = document.querySelector('#state-title')
const stateHint = document.querySelector('#state-hint')
const stateCode = document.querySelector('#state-code')
const sleepSymbols = document.querySelector('#sleep-symbols')
const joyRipples = document.querySelector('#joy-ripples')
const cameraPanel = document.querySelector('#camera-panel')
const cameraToggle = document.querySelector('#camera-toggle')
const cameraAction = document.querySelector('#camera-action')
const cameraVideo = document.querySelector('#camera-video')
const cameraCanvas = document.querySelector('#hand-canvas')
const cameraPlaceholder = document.querySelector('#camera-placeholder')
const cameraPlaceholderCopy = document.querySelector('#camera-placeholder-copy')
const cameraCopy = document.querySelector('#camera-copy')
const gestureCopy = document.querySelector('#gesture-copy')
const bootOverlay = document.querySelector('#boot-overlay')
const bootPercent = document.querySelector('#boot-percent')
const bootProgress = document.querySelector('#boot-progress')
const characterStage = document.querySelector('#character-stage')

const STATE_COPY = {
  booting: ['EMOTION LINK', '正在唤醒…', '让微光找到她的轮廓'],
  awake: ['AWAKE · 已苏醒', '她正在看着你', '向她挥挥手，看看会发生什么'],
  smiling: ['JOY · 捕捉到问候', '你好呀', '你的挥手让她很开心'],
  sleeping: ['SLEEP · 休眠中', '晚安，做个好梦', '张开五指，轻轻唤醒她'],
}

let characterState = 'booting'
let cameraState = 'idle'
let currentGesture = 'none'
let cooldownUntil = 0
let smileTimer = 0
let stream = null
let visionFrame = 0
let lastVisionAt = 0
let shownCamera = true
let cameraDetail = ''
let handLandmarker = null
let handLandmarkerPromise = null
let lastVideoTime = -1
let usingFallbackVision = false

const HAND_MODEL_BASE = './public/vendor/mediapipe'
const HAND_MODEL_MODULE = `${HAND_MODEL_BASE}/vision_bundle.mjs`
const HAND_WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
const HAND_MODEL_ASSET = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task'
const FINGERTIP_INDEXES = [4, 8, 12, 16, 20]

function setCharacterState(next, sourceGesture = 'none') {
  characterState = next
  const [eyebrow, title, hint] = STATE_COPY[next]
  app.className = `app state-${next}`
  if (stateEyebrow) stateEyebrow.textContent = eyebrow
  if (stateTitle) stateTitle.textContent = title
  if (stateHint) stateHint.textContent = hint
  stateCode.textContent = next.toUpperCase()
  sleepSymbols.style.display = next === 'sleeping' ? 'block' : 'none'
  joyRipples.style.display = next === 'smiling' ? 'block' : 'none'
  setGesture(sourceGesture)
  cooldownUntil = performance.now() + 850
  holdPose = 'none'
  holdStarted = 0
  resetWave()
  clearTimeout(smileTimer)
  if (next === 'smiling') smileTimer = setTimeout(() => setCharacterState('awake'), 1800)
}

function setGesture(next) {
  currentGesture = next
  document.querySelectorAll('[data-gesture]').forEach((item) => item.classList.toggle('active', item.dataset.gesture === next))
  const label = next === 'wave' ? '检测到挥手' : next === 'fist' ? '检测到握拳' : next === 'openPalm' ? '检测到张掌' : '等待手势'
  if (cameraState === 'active') gestureCopy.textContent = label
}

function setCameraState(next, detail = '') {
  cameraState = next
  cameraDetail = detail
  cameraPanel.className = `camera-panel camera-${next}${shownCamera ? '' : ' camera-hidden'}`
  const copy = {
    idle: '摄像头尚未开启', requesting: '正在连接摄像头…', active: '五指点位识别中 · 画面不会上传',
    denied: '未获得摄像头权限，已切换演示模式', error: '视觉识别暂不可用，已切换演示模式',
  }
  cameraCopy.firstChild.textContent = cameraDetail || copy[next]
  cameraAction.style.display = next === 'idle' || next === 'denied' || next === 'error' ? 'flex' : 'none'
  cameraPlaceholder.style.display = next === 'active' ? 'none' : 'grid'
  cameraPlaceholderCopy.textContent = next === 'requesting' ? '正在校准…' : '等待视觉信号'
  gestureCopy.textContent = next === 'active' ? '请将一只手放入取景框中央' : '仍可使用下方按钮体验'
}

function cameraSupportMessage() {
  if (!window.isSecureContext) return '请通过 http://localhost:4173 或 HTTPS 打开页面'
  if (!navigator.mediaDevices?.getUserMedia) return '当前浏览器不支持摄像头 API'
  return ''
}

function refreshCameraAvailability() {
  const message = cameraSupportMessage()
  if (!message) return
  setCameraState('error', message)
  gestureCopy.textContent = '请用本机浏览器访问 localhost 页面'
}

refreshCameraAvailability()

document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
  const action = button.dataset.action
  if (action === 'sleep') setCharacterState('sleeping', 'fist')
  if (action === 'wake') setCharacterState('awake', 'openPalm')
  if (action === 'wave') {
    if (characterState === 'sleeping') {
      setCharacterState('awake', 'openPalm')
      setTimeout(() => setCharacterState('smiling', 'wave'), 320)
    } else setCharacterState('smiling', 'wave')
  }
}))

cameraToggle.addEventListener('click', () => {
  shownCamera = !shownCamera
  cameraToggle.textContent = shownCamera ? '隐藏' : '显示'
  cameraPanel.classList.toggle('camera-hidden', !shownCamera)
})

characterStage.addEventListener('pointermove', (event) => {
  const rect = characterStage.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width - .5) * 2
  const y = ((event.clientY - rect.top) / rect.height - .5) * 2
  characterStage.style.setProperty('--tilt-x', `${-y * 4.5}deg`)
  characterStage.style.setProperty('--tilt-y', `${x * 5.5}deg`)
})
characterStage.addEventListener('pointerleave', () => {
  characterStage.style.setProperty('--tilt-x', '0deg')
  characterStage.style.setProperty('--tilt-y', '0deg')
})

// The active gesture system uses five fingertip points from the hand landmark
// model. The color-mask helpers below are kept only as legacy utilities and no
// longer drive gestures, because they can confuse faces with hands.
const sampleCanvas = document.createElement('canvas')
sampleCanvas.width = 160
sampleCanvas.height = 120
const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true })
const mask = new Uint8Array(sampleCanvas.width * sampleCanvas.height)
const visited = new Uint8Array(mask.length)
let holdPose = 'none'
let holdStarted = 0
let waveSamples = []
let waveDirection = 0
let waveReversals = 0
let wavingUntil = 0

function resetWave() { waveSamples = []; waveDirection = 0; waveReversals = 0; wavingUntil = 0 }

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时，请检查网络或刷新重试`)), ms)),
  ])
}

async function initHandLandmarker() {
  if (handLandmarker) return handLandmarker
  if (!handLandmarkerPromise) {
    handLandmarkerPromise = withTimeout(import(HAND_MODEL_MODULE), 12000, '加载手势识别脚本')
      .then(async ({ FilesetResolver, HandLandmarker }) => {
        const vision = await withTimeout(FilesetResolver.forVisionTasks(HAND_WASM_BASE), 12000, '加载手势识别 WASM')
        handLandmarker = await withTimeout(HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: HAND_MODEL_ASSET,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: .52,
          minHandPresenceConfidence: .52,
          minTrackingConfidence: .5,
        }), 16000, '加载手部关键点模型')
        usingFallbackVision = false
        return handLandmarker
      })
      .catch((error) => {
        console.error('Hand landmark model failed to initialize:', error)
        usingFallbackVision = true
        handLandmarkerPromise = null
        return null
      })
  }
  return handLandmarkerPromise
}

function skinPixel(r, g, b) {
  const cb = 128 - .168736 * r - .331264 * g + .5 * b
  const cr = 128 + .5 * r - .418688 * g - .081312 * b
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  return cr > 132 && cr < 181 && cb > 76 && cb < 136 && r > 45 && max - min > 15
}

function isLikelyFaceBlob(blob) {
  const width = blob.maxX - blob.minX + 1
  const height = blob.maxY - blob.minY + 1
  const fill = blob.area / (width * height)
  const aspect = width / height
  const largeOval = blob.area > 1650 && width > 34 && height > 42 && fill > .5 && aspect > .58 && aspect < 1.48
  const inHeadZone = blob.cy < 76 && blob.minY < 42
  return largeOval && inHeadZone
}

function findHandBlob(image) {
  mask.fill(0); visited.fill(0)
  for (let y = 14; y < 118; y += 1) {
    for (let x = 2; x < 158; x += 1) {
      const pixel = (y * 160 + x) * 4
      if (skinPixel(image.data[pixel], image.data[pixel + 1], image.data[pixel + 2])) mask[y * 160 + x] = 1
    }
  }
  let best = null
  const queue = new Int32Array(mask.length)
  for (let seed = 0; seed < mask.length; seed += 1) {
    if (!mask[seed] || visited[seed]) continue
    let head = 0, tail = 0
    queue[tail++] = seed; visited[seed] = 1
    let area = 0, sx = 0, sy = 0, minX = 160, maxX = 0, minY = 120, maxY = 0
    while (head < tail) {
      const id = queue[head++], x = id % 160, y = (id / 160) | 0
      area += 1; sx += x; sy += y; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      const neighbors = [id - 1, id + 1, id - 160, id + 160]
      for (const next of neighbors) if (next >= 0 && next < mask.length && mask[next] && !visited[next] && Math.abs((next % 160) - x) <= 1) { visited[next] = 1; queue[tail++] = next }
    }
    if (area < 130) continue
    const cy = sy / area
    const blob = { area, cx: sx / area, cy, minX, maxX, minY, maxY, pixels: queue.slice(0, tail) }
    if (isLikelyFaceBlob(blob)) continue
    const width = maxX - minX + 1
    const height = maxY - minY + 1
    const handScale = area > 260 && area < 2700 ? 1 : .58
    const score = area * handScale * (cy > 50 ? 1.22 : .78) * (height > 18 && width > 18 ? 1 : .65)
    if (!best || score > best.score) best = { ...blob, score }
  }
  return best
}

function radialPeaks(blob) {
  const bins = new Float32Array(24)
  for (const id of blob.pixels) {
    const x = id % 160, y = (id / 160) | 0
    const dx = x - blob.cx, dy = y - blob.cy
    const angle = Math.atan2(dy, dx) + Math.PI
    const bin = Math.min(23, Math.floor(angle / (Math.PI * 2) * 24))
    bins[bin] = Math.max(bins[bin], Math.hypot(dx, dy))
  }
  const smoothed = Array.from(bins, (_, i) => (bins[(i + 23) % 24] + bins[i] * 2 + bins[(i + 1) % 24]) / 4)
  const sorted = [...smoothed].sort((a, b) => a - b)
  const median = sorted[12]
  let peaks = 0
  smoothed.forEach((value, i) => { if (value > median * 1.24 && value > smoothed[(i + 23) % 24] && value >= smoothed[(i + 1) % 24]) peaks += 1 })
  return peaks
}

function classifyBlob(blob) {
  if (!blob) return 'none'
  const width = blob.maxX - blob.minX + 1, height = blob.maxY - blob.minY + 1
  const fill = blob.area / (width * height)
  const aspect = width / height
  const peaks = radialPeaks(blob)
  if (isLikelyFaceBlob(blob) || blob.area > 3300) return 'none'
  if (blob.area > 360 && blob.area < 3000 && (peaks >= 3 || fill < .48) && width > 24 && height > 28) return 'openPalm'
  if (blob.area > 240 && blob.area < 2400 && peaks <= 2 && fill > .55 && aspect > .58 && aspect < 1.65) return 'fist'
  return 'none'
}

function updateWave(pointState, now) {
  if (pointState?.type !== 'five') { resetWave(); return false }
  const tipXs = pointState.fingertips.map((point) => point.x)
  const tipYs = pointState.fingertips.map((point) => point.y)
  const centerX = pointState.center.x
  const centerY = pointState.center.y
  waveSamples.push({ centerX, centerY, tipXs, tipYs, now })
  waveSamples = waveSamples.filter((sample) => now - sample.now < 520)
  if (waveSamples.length < 2) return now < wavingUntil
  const previous = waveSamples[waveSamples.length - 2]
  const dx = centerX - previous.centerX
  const dy = centerY - previous.centerY
  const distance = Math.hypot(dx, dy)
  const syncedTips = tipXs.filter((x, index) => {
    const tipDx = x - previous.tipXs[index]
    const tipDy = tipYs[index] - previous.tipYs[index]
    const tipDistance = Math.hypot(tipDx, tipDy)
    const sameDirection = dx * tipDx + dy * tipDy > 0
    return tipDistance > .006 && sameDirection
  }).length
  const direction = Math.abs(dx) > .006 && syncedTips >= 4 ? Math.sign(dx) : 0
  if (direction && waveDirection && direction !== waveDirection) waveReversals += 1
  if (direction) waveDirection = direction
  const centers = waveSamples.map((sample) => sample.centerX)
  const amplitude = Math.max(...centers) - Math.min(...centers)
  if ((syncedTips >= 4 && distance > .014) || (waveReversals >= 1 && amplitude > .08) || amplitude > .12) wavingUntil = now + 420
  return now < wavingUntil
}

function processPose(pose, centerX, now, pointState = null) {
  const wave = updateWave(pointState, now)
  setGesture(wave ? 'wave' : pose)
  if (now < cooldownUntil || characterState === 'booting') return
  if (wave) {
    holdPose = 'none'
    holdStarted = 0
    clearTimeout(smileTimer)
    if (characterState !== 'smiling') setCharacterState('smiling', 'wave')
    clearTimeout(smileTimer)
    smileTimer = setTimeout(() => setCharacterState('awake'), 900)
    return
  }
  const wanted = characterState === 'sleeping' ? 'openPalm' : 'fist'
  if (pose !== wanted) { holdPose = 'none'; holdStarted = 0; return }
  if (holdPose !== wanted) { holdPose = wanted; holdStarted = now; return }
  if (now - holdStarted > 600) setCharacterState(wanted === 'fist' ? 'sleeping' : 'awake', wanted)
}

function landmarkDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0))
}

function landmarkCenter(points, indexes) {
  const total = indexes.reduce((sum, index) => ({ x: sum.x + points[index].x, y: sum.y + points[index].y, z: sum.z + (points[index].z || 0) }), { x: 0, y: 0, z: 0 })
  return { x: total.x / indexes.length, y: total.y / indexes.length, z: total.z / indexes.length }
}

function fingerPointState(points) {
  const palmCenter = landmarkCenter(points, [0, 5, 9, 13, 17])
  const palmWidth = Math.max(landmarkDistance(points[5], points[17]), .001)
  const fingertips = FINGERTIP_INDEXES.map((index) => points[index])
  const center = landmarkCenter(points, FINGERTIP_INDEXES)
  const palmDistances = fingertips.map((point) => landmarkDistance(point, palmCenter) / palmWidth)
  const centerDistances = fingertips.map((point) => landmarkDistance(point, center) / palmWidth)
  const averagePalmDistance = palmDistances.reduce((sum, value) => sum + value, 0) / palmDistances.length
  const averageSpread = centerDistances.reduce((sum, value) => sum + value, 0) / centerDistances.length
  const visibleSmallPoints = palmDistances.filter((value) => value > 1.02).length
  const spreadSmallPoints = centerDistances.filter((value) => value > .34).length
  const type = visibleSmallPoints >= 4 && spreadSmallPoints >= 4 && averagePalmDistance > 1.13 && averageSpread > .42 ? 'five' : 'one'
  return { type, fingertips, center, palmCenter, palmWidth, averagePalmDistance, averageSpread }
}

function classifyLandmarks(points) {
  if (!points?.length) return { pose: 'none', centerX: .5 }
  const pointState = fingerPointState(points)
  const pose = pointState.type === 'five' ? 'openPalm' : 'fist'
  return { pose, centerX: pointState.center.x, pointState }
}

function drawFingerPoints(pointState, pose) {
  const rect = cameraCanvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2)
  cameraCanvas.width = Math.round(rect.width * ratio); cameraCanvas.height = Math.round(rect.height * ratio)
  const ctx = cameraCanvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height)
  if (!pointState) return
  ctx.shadowColor = '#42d9ff'; ctx.shadowBlur = 12
  ctx.fillStyle = '#c9f8ff'
  if (pointState.type === 'one') {
    ctx.beginPath()
    ctx.arc(pointState.center.x * rect.width, pointState.center.y * rect.height, 9, 0, Math.PI * 2)
    ctx.fill()
  } else {
    pointState.fingertips.forEach((point) => {
      ctx.beginPath()
      ctx.arc(point.x * rect.width, point.y * rect.height, 4.2, 0, Math.PI * 2)
      ctx.fill()
    })
  }
  ctx.font = '10px ui-monospace'
  ctx.fillText(pose === 'openPalm' ? 'FIVE POINTS' : pose === 'fist' ? 'ONE POINT' : 'TRACKING', pointState.center.x * rect.width + 10, Math.max(12, pointState.center.y * rect.height - 8))
}

function drawBlob(blob, pose) {
  const rect = cameraCanvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2)
  cameraCanvas.width = Math.round(rect.width * ratio); cameraCanvas.height = Math.round(rect.height * ratio)
  const ctx = cameraCanvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height)
  if (!blob) return
  const sx = rect.width / 160, sy = rect.height / 120
  ctx.strokeStyle = '#73eaff'; ctx.lineWidth = 1.5; ctx.shadowColor = '#42d9ff'; ctx.shadowBlur = 10
  ctx.strokeRect(blob.minX * sx, blob.minY * sy, (blob.maxX - blob.minX) * sx, (blob.maxY - blob.minY) * sy)
  ctx.fillStyle = '#c9f8ff'; ctx.font = '10px ui-monospace'; ctx.fillText(pose === 'openPalm' ? 'OPEN PALM' : pose === 'fist' ? 'FIST' : 'TRACKING', blob.minX * sx, Math.max(12, blob.minY * sy - 5))
}

function clearCameraCanvas() {
  const rect = cameraCanvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2)
  cameraCanvas.width = Math.round(rect.width * ratio); cameraCanvas.height = Math.round(rect.height * ratio)
  const ctx = cameraCanvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height)
}

function visionLoop(now) {
  if (cameraState !== 'active') return
  if (now - lastVisionAt > 75 && cameraVideo.readyState >= 2) {
    lastVisionAt = now
    if (handLandmarker && cameraVideo.currentTime !== lastVideoTime) {
      lastVideoTime = cameraVideo.currentTime
      const result = handLandmarker.detectForVideo(cameraVideo, now)
      const points = result.landmarks?.[0]
      if (points) {
        const { pose, centerX, pointState } = classifyLandmarks(points)
        drawFingerPoints(pointState, pose)
        processPose(pose, centerX, now, pointState)
      } else {
        clearCameraCanvas()
        processPose('none', .5, now)
      }
    } else {
      clearCameraCanvas()
      processPose('none', .5, now)
    }
  }
  visionFrame = requestAnimationFrame(visionLoop)
}

cameraAction.addEventListener('click', async () => {
  setCameraState('requesting')
  try {
    const supportMessage = cameraSupportMessage()
    if (supportMessage) throw new Error(supportMessage)
    cancelAnimationFrame(visionFrame)
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    usingFallbackVision = false
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false })
    cameraVideo.srcObject = stream
    cameraVideo.muted = true
    cameraVideo.playsInline = true
    await cameraVideo.play()
    setCameraState('active', '正在下载指尖识别模型 · 首次可能需要十几秒')
    gestureCopy.textContent = '加载完成后才会开始识别手势'
    initHandLandmarker().then((detector) => {
      if (cameraState !== 'active') return
      const detail = detector ? '五指点位识别中 · 画面不会上传' : '指尖模型不可用 · 请检查网络后重试'
      setCameraState('active', detail)
      if (!detector) gestureCopy.textContent = '无法加载指尖模型，已停止肤色方框识别'
    })
    visionFrame = requestAnimationFrame(visionLoop)
  } catch (error) {
    const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError'
    setCameraState(denied ? 'denied' : 'error', denied ? '' : error?.message)
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
  }
})

window.addEventListener('beforeunload', () => { cancelAnimationFrame(visionFrame); stream?.getTracks().forEach((track) => track.stop()) })

// Particle boot / ambient field
const particlesCanvas = document.querySelector('#particle-field')
const particlesContext = particlesCanvas.getContext('2d')
let particles = [], particleStart = performance.now()
function resizeParticles() {
  const rect = particlesCanvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2)
  particlesCanvas.width = rect.width * ratio; particlesCanvas.height = rect.height * ratio; particlesContext.setTransform(ratio, 0, 0, ratio, 0, 0)
  const count = Math.min(260, Math.max(120, Math.floor(rect.width / 4)))
  particles = Array.from({ length: count }, (_, i) => { const a = i / count * Math.PI * 2, wobble = Math.sin(i * 11.7) * 10; return { x: Math.random() * rect.width, y: Math.random() * rect.height, vx: 0, vy: 0, tx: rect.width / 2 + Math.cos(a) * (rect.width * .31 + wobble), ty: rect.height / 2 + Math.sin(a) * (rect.height * .38 + wobble), size: Math.random() * 1.7 + .5, alpha: Math.random() * .7 + .2, phase: Math.random() * Math.PI * 2 } })
}
function particlesLoop(now) {
  const rect = particlesCanvas.getBoundingClientRect(); particlesContext.clearRect(0, 0, rect.width, rect.height)
  const booting = characterState === 'booting'
  particles.forEach((p, i) => { p.vx += (p.tx - p.x) * (booting ? .004 : .0008) + (booting ? 0 : Math.cos(now * .00045 + p.phase) * .018); p.vy += (p.ty - p.y) * (booting ? .004 : .0008) + (booting ? 0 : Math.sin(now * .00055 + p.phase) * .018); p.vx *= .93; p.vy *= .93; p.x += p.vx; p.y += p.vy; const pulse = .6 + Math.sin(now * .002 + p.phase) * .35; particlesContext.beginPath(); particlesContext.fillStyle = `rgba(${i % 4 ? '72,184,255' : '137,244,255'},${p.alpha * pulse})`; particlesContext.shadowColor = '#42d9ff'; particlesContext.shadowBlur = booting ? 12 : 6; particlesContext.arc(p.x, p.y, p.size * (booting ? 1.3 : 1), 0, Math.PI * 2); particlesContext.fill() })
  requestAnimationFrame(particlesLoop)
}
resizeParticles(); addEventListener('resize', resizeParticles); requestAnimationFrame(particlesLoop)

const bootStarted = performance.now()
function bootTick(now) {
  const progress = Math.min((now - bootStarted) / 3200, 1)
  bootPercent.textContent = `${String(Math.round(progress * 100)).padStart(2, '0')}%`
  bootProgress.style.transform = `scaleX(${progress})`
  if (progress < 1) requestAnimationFrame(bootTick)
  else { setCharacterState('awake'); bootOverlay.remove() }
}
sleepSymbols.style.display = 'none'; joyRipples.style.display = 'none'; requestAnimationFrame(bootTick)
