// Global variables
let cameraStream = null;
let videoElement = null;
let answerKey = [];
let studentAnswers = [];
let cvReady = false;
let isScanningKey = false;

// DOM elements
const scanKeyBtn = document.getElementById('scanKeyBtn');
const scanAnswersBtn = document.getElementById('scanAnswersBtn');
const resetBtn = document.getElementById('resetBtn');
const cameraView = document.getElementById('cameraView');
const overlay = document.getElementById('overlay');
const scoreDisplay = document.getElementById('score');
const answerComparison = document.getElementById('answerComparison');

// Initialize OpenCV
function initOpenCV() {
  return new Promise((resolve) => {
    if (typeof cv !== 'undefined') {
      cv.onRuntimeInitialized = () => {
        cvReady = true;
        console.log('OpenCV ready');
        resolve();
      };
    } else {
      console.error('OpenCV not loaded');
      resolve();
    }
  });
}

// Start camera with proper error handling
async function startCamera() {
  try {
    // Stop any existing camera stream
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
    }

    // Request camera access
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    
    // Create video element
    videoElement = document.createElement('video');
    videoElement.srcObject = cameraStream;
    videoElement.setAttribute('playsinline', '');
    videoElement.setAttribute('autoplay', '');
    videoElement.setAttribute('muted', '');
    
    // Wait for video to be ready
    await new Promise((resolve) => {
      videoElement.onloadedmetadata = () => {
        videoElement.play().then(resolve).catch(resolve);
      };
    });
    
    // Clear and display video
    cameraView.innerHTML = '';
    cameraView.appendChild(videoElement);
    
    return true;
  } catch (error) {
    console.error('Camera error:', error);
    alert('Camera error: ' + error.message);
    return false;
  }
}

// Process OMR sheet
async function processOMR() {
  const canvas = document.getElementById('processingCanvas');
  const ctx = canvas.getContext('2d');
  
  // Set canvas dimensions to match video
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  
  // Capture current frame
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  
  // Add visual feedback
  cameraView.classList.add('flash');
  setTimeout(() => cameraView.classList.remove('flash'), 200);
  
  // Process with OpenCV
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  
  const thresh = new cv.Mat();
  cv.adaptiveThreshold(
    gray,
    thresh,
    255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV,
    11,
    2
  );
  
  // Process 20 questions (A-E)
  const answers = [];
  const questionSpacing = canvas.height / 21;
  const optionSpacing = canvas.width / 6;
  
  for (let q = 0; q < 20; q++) {
    let maxMarked = { val: -1, option: null };
    
    for (let o = 0; o < 5; o++) {
      const x = optionSpacing * (o + 0.5);
      const y = questionSpacing * (q + 1);
      const radius = Math.min(optionSpacing, questionSpacing) * 0.3;
      
      const bubbleArea = thresh.roi(new cv.Rect(
        x - radius,
        y - radius,
        radius * 2,
        radius * 2
      ));
      
      const marked = cv.countNonZero(bubbleArea);
      bubbleArea.delete();
      
      if (marked > maxMarked.val) {
        maxMarked = { val: marked, option: String.fromCharCode(65 + o) };
      }
    }
    
    answers.push(maxMarked.option);
  }
  
  // Clean up
  src.delete();
  gray.delete();
  thresh.delete();
  
  return answers;
}

// Compare answers and calculate score
function compareAnswers() {
  let score = 0;
  const comparison = [];
  
  for (let i = 0; i < 20; i++) {
    const isCorrect = studentAnswers[i] === answerKey[i];
    if (isCorrect) score++;
    
    comparison.push({
      number: i + 1,
      student: studentAnswers[i],
      key: answerKey[i],
      correct: isCorrect
    });
  }
  
  return { score, comparison };
}

// Display comparison results
function displayResults() {
  const { score, comparison } = compareAnswers();
  
  scoreDisplay.textContent = score + '/20';
  answerComparison.innerHTML = '';
  
  comparison.forEach(item => {
    const row = document.createElement('div');
    row.className = 'answer-row ' + (item.correct ? 'correct' : 'incorrect');
    
    row.innerHTML = `
      <div class="answer-num">${item.number}.</div>
      <div class="answer-value">${item.student || '?'}</div>
      <div class="answer-value">${item.key}</div>
      <div>${item.correct ? '✓' : '✗'}</div>
    `;
    
    answerComparison.appendChild(row);
  });
}

// Stop camera
function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  cameraView.innerHTML = '';
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
  await initOpenCV();
  
  // Scan Answer Key
  scanKeyBtn.addEventListener('click', async () => {
    if (!cvReady) {
      alert('Image processing is still loading. Please wait...');
      return;
    }
    
    isScanningKey = true;
    scanKeyBtn.disabled = true;
    scanKeyBtn.textContent = 'Starting camera...';
    
    const started = await startCamera();
    if (!started) {
      scanKeyBtn.disabled = false;
      scanKeyBtn.textContent = '1. Scan Answer Key';
      return;
    }
    
    scanKeyBtn.textContent = 'Capture Answer Key';
    scanKeyBtn.disabled = false;
    
    // Temporary onclick handler
    const captureHandler = async () => {
      try {
        scanKeyBtn.disabled = true;
        scanKeyBtn.textContent = 'Processing...';
        
        answerKey = await processOMR();
        stopCamera();
        
        scanKeyBtn.textContent = '✓ Answer Key Scanned';
        scanAnswersBtn.disabled = false;
        isScanningKey = false;
      } catch (error) {
        console.error('Processing error:', error);
        alert('Error processing answer key. Please try again.');
        scanKeyBtn.disabled = false;
        scanKeyBtn.textContent = 'Capture Answer Key';
      }
    };
    
    scanKeyBtn.onclick = captureHandler;
  });
  
  // Scan Student Answers
  scanAnswersBtn.addEventListener('click', async () => {
    scanAnswersBtn.disabled = true;
    scanAnswersBtn.textContent = 'Starting camera...';
    
    const started = await startCamera();
    if (!started) {
      scanAnswersBtn.disabled = false;
      scanAnswersBtn.textContent = '2. Scan Student Answers';
      return;
    }
    
    scanAnswersBtn.textContent = 'Capture Student Answers';
    scanAnswersBtn.disabled = false;
    
    // Temporary onclick handler
    const captureHandler = async () => {
      try {
        scanAnswersBtn.disabled = true;
        scanAnswersBtn.textContent = 'Processing...';
        
        studentAnswers = await processOMR();
        stopCamera();
        
        scanAnswersBtn.textContent = '✓ Answers Scanned';
        displayResults();
      } catch (error) {
        console.error('Processing error:', error);
        alert('Error processing answers. Please try again.');
        scanAnswersBtn.disabled = false;
        scanAnswersBtn.textContent = 'Capture Student Answers';
      }
    };
    
    scanAnswersBtn.onclick = captureHandler;
  });
  
  // Reset
  resetBtn.addEventListener('click', () => {
    stopCamera();
    answerKey = [];
    studentAnswers = [];
    scanKeyBtn.textContent = '1. Scan Answer Key';
    scanKeyBtn.disabled = false;
    scanKeyBtn.onclick = null;
    scanAnswersBtn.textContent = '2. Scan Student Answers';
    scanAnswersBtn.disabled = true;
    scanAnswersBtn.onclick = null;
    scoreDisplay.textContent = '-';
    answerComparison.innerHTML = '';
  });
});

// Clean up on page exit
window.addEventListener('beforeunload', () => {
  stopCamera();
});
