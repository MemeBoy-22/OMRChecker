// Global variables
let cvReady = false;
let stream = null;
let videoElement = null;
let flashOn = false;
let answerKey = [];

// DOM elements
const startCameraBtn = document.getElementById('startCameraBtn');
const captureBtn = document.getElementById('captureBtn');
const toggleFlashBtn = document.getElementById('toggleFlashBtn');
const cameraPreview = document.getElementById('cameraPreview');
const scannerOverlay = document.getElementById('scannerOverlay');
const resultContainer = document.getElementById('resultContainer');
const processingCanvas = document.getElementById('processingCanvas');

// Initialize OpenCV
function initializeOpenCV() {
  return new Promise((resolve) => {
    if (window.cv) {
      cv.onRuntimeInitialized = () => {
        cvReady = true;
        console.log('OpenCV ready');
        resolve();
      };
    } else {
      console.error('OpenCV.js not loaded');
      resolve();
    }
  });
}

// Create scanner overlay
function createScannerOverlay() {
  scannerOverlay.innerHTML = '';
  
  // ID section overlay
  const idOverlay = document.createElement('div');
  idOverlay.id = 'idOverlay';
  idOverlay.className = 'overlay-guide';
  idOverlay.title = 'Align ID section here';
  scannerOverlay.appendChild(idOverlay);
  
  // Questions section overlay
  const questionsOverlay = document.createElement('div');
  questionsOverlay.id = 'questionsOverlay';
  questionsOverlay.className = 'overlay-guide';
  questionsOverlay.title = 'Align questions here';
  scannerOverlay.appendChild(questionsOverlay);
}

// Start camera
async function startCamera() {
  try {
    // Check for camera support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera access not supported by your browser');
    }
    
    // Request camera access
    stream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      } 
    });
    
    // Create video element
    videoElement = document.createElement('video');
    videoElement.srcObject = stream;
    videoElement.setAttribute('playsinline', '');
    videoElement.play();
    
    // Clear preview and add video
    cameraPreview.innerHTML = '';
    cameraPreview.appendChild(videoElement);
    
    // Enable buttons
    captureBtn.disabled = false;
    toggleFlashBtn.disabled = false;
    startCameraBtn.disabled = true;
    
    // Create overlay
    createScannerOverlay();
    
    // Start alignment detection
    detectAlignment();
    
  } catch (error) {
    alert(`Camera error: ${error.message}`);
    console.error('Camera error:', error);
  }
}

// Detect alignment quality
function detectAlignment() {
  if (!videoElement) return;
  
  // Create canvas for alignment detection
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  
  // Draw frame and analyze
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  // Check for black borders (simplified)
  const borderThreshold = 50; // Dark enough to be border
  let borderMatches = 0;
  let totalBorderPixels = 0;
  
  // Sample border pixels
  for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i];
    const g = imageData.data[i + 1];
    const b = imageData.data[i + 2];
    const brightness = (r + g + b) / 3;
    
    // Check if pixel is in border area
    const x = (i / 4) % canvas.width;
    const y = Math.floor((i / 4) / canvas.width);
    
    if (x < 10 || x > canvas.width - 10 || y < 10 || y > canvas.height - 10) {
      totalBorderPixels++;
      if (brightness < borderThreshold) {
        borderMatches++;
      }
    }
  }
  
  // Calculate alignment score
  const alignmentScore = borderMatches / totalBorderPixels;
  const isAligned = alignmentScore > 0.7; // 70% of border is dark
  
  // Update UI
  const overlayElements = document.querySelectorAll('.overlay-guide');
  overlayElements.forEach(el => {
    el.classList.remove('alignment-good', 'alignment-bad');
    el.classList.add(isAligned ? 'alignment-good' : 'alignment-bad');
  });
  
  // Continue monitoring
  requestAnimationFrame(detectAlignment);
}

// Capture image
async function captureImage() {
  if (!videoElement) return;
  
  try {
    // Add flash effect
    cameraPreview.classList.add('flash-effect');
    setTimeout(() => cameraPreview.classList.remove('flash-effect'), 500);
    
    // Create canvas from video frame
    processingCanvas.width = videoElement.videoWidth;
    processingCanvas.height = videoElement.videoHeight;
    const ctx = processingCanvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, processingCanvas.width, processingCanvas.height);
    
    // Process the OMR sheet
    const result = await processOMRSheet(processingCanvas);
    
    // Display results
    displayResults(result);
    
  } catch (error) {
    alert(`Processing error: ${error.message}`);
    console.error('Processing error:', error);
  }
}

// Process OMR sheet
async function processOMRSheet(canvas) {
  if (!cvReady) {
    throw new Error('OpenCV is not ready yet');
  }
  
  const src = cv.imread(canvas);
  
  // Preprocessing pipeline
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  
  const blur = new cv.Mat();
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
  
  const thresh = new cv.Mat();
  cv.adaptiveThreshold(
    blur, 
    thresh,
    255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV,
    11,
    2
  );
  
  // Process ID section (4 digits)
  const idDigits = [];
  const idStartX = 0.7 * canvas.width; // Adjust based on your overlay
  const idStartY = 0.1 * canvas.height;
  const idColGap = 0.05 * canvas.width;
  const idRowGap = 0.03 * canvas.height;
  const idSize = 0.04 * canvas.width;
  
  for (let c = 0; c < 4; c++) {
    let maxVal = -1, digit = 0;
    for (let r = 0; r < 10; r++) {
      const x = Math.round(idStartX + c * idColGap);
      const y = Math.round(idStartY + r * idRowGap);
      const cell = thresh.roi(new cv.Rect(x, y, idSize, idSize));
      const val = cv.countNonZero(cell);
      if (val > maxVal) {
        maxVal = val;
        digit = r;
      }
      cell.delete();
    }
    idDigits.push(digit);
  }
  
  // Process answer bubbles (20 questions × 5 choices)
  const answers = [];
  const qStartX = 0.1 * canvas.width;
  const qStartY = 0.25 * canvas.height;
  const qColGap = 0.08 * canvas.width;
  const qRowGap = 0.03 * canvas.height;
  const qSize = 0.04 * canvas.width;
  
  for (let r = 0; r < 20; r++) {
    let maxVal = -1, marked = 0;
    for (let c = 0; c < 5; c++) {
      const x = Math.round(qStartX + c * qColGap);
      const y = Math.round(qStartY + r * qRowGap);
      const bubble = thresh.roi(new cv.Rect(x, y, qSize, qSize));
      const nonZero = cv.countNonZero(bubble);
      if (nonZero > maxVal) {
        maxVal = nonZero;
        marked = c;
      }
      bubble.delete();
    }
    answers.push(['A', 'B', 'C', 'D', 'E'][marked]);
  }
  
  // Clean up
  src.delete();
  gray.delete();
  blur.delete();
  thresh.delete();
  
  return {
    id: idDigits.join(''),
    answers,
    timestamp: new Date().toLocaleString()
  };
}

// Display results
function displayResults(result) {
  const resultBox = document.createElement('div');
  resultBox.className = 'result-box';
  
  let content = `
    <h3>Scan Results</h3>
    <p><strong>ID:</strong> ${result.id}</p>
    <p><strong>Time:</strong> ${result.timestamp}</p>
    <div class="answers-grid">
  `;
  
  // Display answers in a grid
  for (let i = 0; i < result.answers.length; i++) {
    content += `
      <div class="answer-item">
        <span class="question-num">${i + 1}</span>
        <span class="answer-value">${result.answers[i]}</span>
      </div>
    `;
  }
  
  content += `</div>`;
  resultBox.innerHTML = content;
  resultContainer.appendChild(resultBox);
}

// Toggle flash
function toggleFlash() {
  if (!stream) return;
  
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack || !('applyConstraints' in videoTrack)) {
    alert('Flash not supported on this device');
    return;
  }
  
  flashOn = !flashOn;
  toggleFlashBtn.textContent = flashOn ? 'Flash ON' : 'Flash OFF';
  
  videoTrack.applyConstraints({
    advanced: [{ torch: flashOn }]
  }).catch(e => console.error('Flash error:', e));
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
  await initializeOpenCV();
  
  startCameraBtn.addEventListener('click', startCamera);
  captureBtn.addEventListener('click', captureImage);
  toggleFlashBtn.addEventListener('click', toggleFlash);
  
  // Clean up camera on page unload
  window.addEventListener('beforeunload', () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  });
});
