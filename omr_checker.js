let cameraStream = null;
let videoElement = null;
let answerKey = [];
let studentAnswers = [];
let cvReady = false;

// DOM elements
const scanKeyBtn = document.getElementById('scanKeyBtn');
const scanAnswersBtn = document.getElementById('scanAnswersBtn');
const resetBtn = document.getElementById('resetBtn');
const cameraView = document.getElementById('cameraView');
const scoreDisplay = document.getElementById('score');
const answerComparison = document.getElementById('answerComparison');

// Initialize OpenCV
function initOpenCV() {
  return new Promise((resolve) => {
    if (window.cv) {
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

// Start camera
async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    
    videoElement = document.createElement('video');
    videoElement.srcObject = cameraStream;
    videoElement.setAttribute('playsinline', '');
    videoElement.play();
    
    cameraView.innerHTML = '';
    cameraView.appendChild(videoElement);
    
    return true;
  } catch (error) {
    console.error('Camera error:', error);
    alert('Could not access camera. Please ensure permissions are granted.');
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
  const questionSpacing = canvas.height / 21; // 20 questions with spacing
  const optionSpacing = canvas.width / 6; // 5 options with spacing
  
  for (let q = 0; q < 20; q++) {
    let maxMarked = { val: -1, option: null };
    
    for (let o = 0; o < 5; o++) {
      const x = optionSpacing * (o + 0.5);
      const y = questionSpacing * (q + 1);
      const radius = Math.min(optionSpacing, questionSpacing) * 0.3;
      
      // Count marked pixels in bubble area
      const bubbleArea = thresh.roi(new cv.Rect(
        x - radius,
        y - radius,
        radius * 2,
        radius * 2
      ));
      
      const marked = cv.countNonZero(bubbleArea);
      bubbleArea.delete();
      
      if (marked > maxMarked.val) {
        maxMarked = { val: marked, option: String.fromCharCode(65 + o) }; // 65 = 'A'
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
  
  scoreDisplay.textContent = `${score}/20`;
  answerComparison.innerHTML = '';
  
  comparison.forEach(item => {
    const row = document.createElement('div');
    row.className = `answer-row ${item.correct ? 'correct' : 'incorrect'}`;
    
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
      alert('OpenCV is still loading. Please wait...');
      return;
    }
    
    const started = await startCamera();
    if (!started) return;
    
    scanKeyBtn.textContent = 'Capture Answer Key';
    scanKeyBtn.onclick = async () => {
      answerKey = await processOMR();
      stopCamera();
      scanKeyBtn.textContent = 'Answer Key Scanned';
      scanKeyBtn.disabled = true;
      scanAnswersBtn.disabled = false;
    };
  });
  
  // Scan Student Answers
  scanAnswersBtn.addEventListener('click', async () => {
    const started = await startCamera();
    if (!started) return;
    
    scanAnswersBtn.textContent = 'Capture Student Answers';
    scanAnswersBtn.onclick = async () => {
      studentAnswers = await processOMR();
      stopCamera();
      scanAnswersBtn.textContent = 'Answers Scanned';
      displayResults();
    };
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
