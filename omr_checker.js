// Global variables
let cvReady = false;
let answerKey = [];
let filesToProcess = [];
let processingMode = 'generic';

// OpenCV initialization
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

// DOM elements
const keyFileInput = document.getElementById('keyFile');
const sheetImageInput = document.getElementById('sheetImage');
const processBtn = document.getElementById('processBtn');
const resultContainer = document.getElementById('resultContainer');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const keyInfo = document.getElementById('keyInfo');
const sheetInfo = document.getElementById('sheetInfo');

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  initializeOpenCV().then(() => {
    processBtn.disabled = false;
  });
  
  // Mode selection
  document.querySelectorAll('input[name="mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      processingMode = e.target.value;
    });
  });
  
  // Answer key upload
  keyFileInput.addEventListener('change', handleKeyUpload);
  
  // Sheet images upload
  sheetImageInput.addEventListener('change', handleSheetUpload);
  
  // Process button
  processBtn.addEventListener('click', processSheets);
});

function handleKeyUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target.result.trim();
      answerKey = content.startsWith('[') 
        ? JSON.parse(content) 
        : content.split('\n').map(x => x.trim()).filter(x => x);
      
      keyInfo.innerHTML = `
        <div class="upload-info">
          <strong>Loaded:</strong> ${file.name}<br>
          <strong>Questions:</strong> ${answerKey.length}
        </div>
      `;
      
      console.log('Answer key loaded:', answerKey);
    } catch (error) {
      keyInfo.innerHTML = `<div class="upload-error">Error: ${error.message}</div>`;
      console.error('Error parsing answer key:', error);
    }
  };
  reader.readAsText(file);
}

function handleSheetUpload(event) {
  filesToProcess = Array.from(event.target.files);
  
  sheetInfo.innerHTML = `
    <div class="upload-info">
      <strong>Selected:</strong> ${filesToProcess.length} file(s)
    </div>
  `;
}

async function processSheets() {
  // Validate inputs
  if (answerKey.length === 0) {
    alert('Please upload a valid answer key first');
    return;
  }
  
  if (filesToProcess.length === 0) {
    alert('Please upload at least one OMR sheet image');
    return;
  }
  
  if (!cvReady) {
    alert('OpenCV is still loading. Please wait...');
    return;
  }
  
  // Reset UI
  resultContainer.innerHTML = '';
  progressContainer.style.display = 'block';
  updateProgress(0);
  processBtn.disabled = true;
  
  // Process each sheet
  for (let i = 0; i < filesToProcess.length; i++) {
    const file = filesToProcess[i];
    const result = await processSheet(file);
    
    displayResult(result, i);
    updateProgress(((i + 1) / filesToProcess.length) * 100);
  }
  
  processBtn.disabled = false;
}

function updateProgress(percent) {
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${Math.round(percent)}%`;
}

async function processSheet(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.getElementById('canvas');
      const ctx = canvas.getContext('2d');
      
      // Set canvas dimensions
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      // Process based on mode
      let result;
      try {
        if (processingMode === 'specific') {
          result = processSpecificOMR(canvas);
        } else {
          result = processGenericOMR(canvas);
        }
        
        result.fileName = file.name;
        resolve(result);
      } catch (error) {
        console.error('Error processing sheet:', error);
        resolve({
          fileName: file.name,
          error: error.message
        });
      }
    };
    img.src = URL.createObjectURL(file);
  });
}

function processGenericOMR(canvas) {
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
  
  // Find contours
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(
    thresh,
    contours,
    hierarchy,
    cv.RETR_EXTERNAL,
    cv.CHAIN_APPROX_SIMPLE
  );
  
  // Process contours
  const bubbleContours = [];
  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const area = cv.contourArea(contour);
    
    // Filter by size
    if (area < 100 || area > 5000) continue;
    
    const perimeter = cv.arcLength(contour, true);
    const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
    
    // Filter by circularity
    if (circularity > 0.7) {
      bubbleContours.push(contour);
    }
  }
  
  // Sort bubbles by position
  bubbleContours.sort((a, b) => {
    const rectA = cv.boundingRect(a);
    const rectB = cv.boundingRect(b);
    
    // Compare by vertical position first
    const yDiff = rectA.y - rectB.y;
    if (Math.abs(yDiff) > 10) return yDiff;
    
    // Then horizontal position
    return rectA.x - rectB.x;
  });
  
  // Group bubbles into rows (questions)
  const rows = [];
  let currentRow = [];
  let lastY = -1;
  
  bubbleContours.forEach(contour => {
    const rect = cv.boundingRect(contour);
    if (lastY === -1) lastY = rect.y;
    
    // New row if Y position changes significantly
    if (Math.abs(rect.y - lastY) > 10) {
      if (currentRow.length > 0) rows.push(currentRow);
      currentRow = [];
      lastY = rect.y;
    }
    
    currentRow.push({ contour, rect });
  });
  if (currentRow.length > 0) rows.push(currentRow);
  
  // Process answers
  const sheetAnswers = [];
  const questionCount = Math.min(rows.length, answerKey.length);
  
  for (let i = 0; i < questionCount; i++) {
    const row = rows[i];
    // Sort row horizontally
    row.sort((a, b) => a.rect.x - b.rect.x);
    
    // Find marked bubble
    let markedIndex = -1;
    let maxFillRatio = 0;
    
    for (let j = 0; j < Math.min(row.length, 5); j++) {
      const { rect } = row[j];
      const bubbleRegion = thresh.roi(rect);
      
      // Calculate fill ratio
      const filled = cv.countNonZero(bubbleRegion);
      const total = rect.width * rect.height;
      const fillRatio = filled / total;
      
      bubbleRegion.delete();
      
      if (fillRatio > 0.5 && fillRatio > maxFillRatio) {
        maxFillRatio = fillRatio;
        markedIndex = j;
      }
    }
    
    sheetAnswers.push(markedIndex !== -1 ? ['A','B','C','D','E'][markedIndex] : null);
  }
  
  // Calculate score
  let score = 0;
  const details = [];
  
  for (let i = 0; i < questionCount; i++) {
    const correct = sheetAnswers[i] === answerKey[i];
    if (correct) score++;
    
    details.push({
      question: i + 1,
      answered: sheetAnswers[i],
      correct: answerKey[i],
      isCorrect: correct
    });
  }
  
  // Clean up
  src.delete();
  gray.delete();
  blur.delete();
  thresh.delete();
  contours.delete();
  hierarchy.delete();
  
  return {
    score,
    total: questionCount,
    percentage: Math.round((score / questionCount) * 100),
    details,
    type: 'generic'
  };
}

function processSpecificOMR(canvas) {
  const src = cv.imread(canvas);
  
  // Preprocessing
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  
  const thresh = new cv.Mat();
  cv.adaptiveThreshold(
    gray, 
    thresh, 
    255, 
    cv.ADAPTIVE_THRESH_MEAN_C, 
    cv.THRESH_BINARY_INV, 
    15, 
    10
  );
  
  // Answer bubbles (20 × 5)
  const rows = 20, cols = 5;
  const startX = 135, startY = 190,
        rowGap = 31.5, colGap = 33.5, bubbleSize = 22;
  const bubbleAnswers = [];
  
  for (let r = 0; r < rows; r++) {
    let maxVal = -1, marked = 0;
    for (let c = 0; c < cols; c++) {
      const x = Math.round(startX + c * colGap),
            y = Math.round(startY + r * rowGap);
      const bubble = thresh.roi(new cv.Rect(x, y, bubbleSize, bubbleSize));
      const nonZero = cv.countNonZero(bubble);
      if (nonZero > maxVal) {
        maxVal = nonZero;
        marked = c;
      }
      bubble.delete();
    }
    bubbleAnswers.push(['A','B','C','D','E'][marked]);
  }
  
  // Score calculation
  let score = 0;
  const details = [];
  const questionCount = Math.min(bubbleAnswers.length, answerKey.length);
  
  for (let i = 0; i < questionCount; i++) {
    const correct = bubbleAnswers[i] === answerKey[i];
    if (correct) score++;
    
    details.push({
      question: i + 1,
      answered: bubbleAnswers[i],
      correct: answerKey[i],
      isCorrect: correct
    });
  }
  
  // 4-digit ID detection
  const idStartX = 620, idStartY = 220,
        idColGap = 40, idRowGap = 27, idSize = 22;
  const idDigits = [];
  for (let c = 0; c < 4; c++) {
    let maxVal = -1, digit = 0;
    for (let r = 0; r < 10; r++) {
      const x = idStartX + c * idColGap,
            y = idStartY + r * idRowGap;
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
  
  // Clean up
  src.delete();
  gray.delete();
  thresh.delete();
  
  return {
    score,
    total: questionCount,
    percentage: Math.round((score / questionCount) * 100),
    details,
    id: idDigits.join(''),
    type: 'specific'
  };
}

function displayResult(result, index) {
  const resultBox = document.createElement('div');
  resultBox.className = 'result-box';
  
  let content = `
    <h3>Sheet ${index + 1}: ${result.fileName}</h3>
    <p><strong>Score:</strong> ${result.score}/${result.total} (${result.percentage}%)</p>
  `;
  
  if (result.type === 'specific') {
    content += `<p><strong>ID:</strong> ${result.id}</p>`;
  }
  
  if (result.error) {
    content += `<div class="error">Error: ${result.error}</div>`;
  } else {
    content += `<div class="details">`;
    result.details.forEach(d => {
      content += `
        <div class="question-result ${d.isCorrect ? 'correct' : 'incorrect'}">
          Q${d.question}: ${d.answered || 'Unanswered'} 
          ${d.isCorrect ? '✓' : `✗ (Correct: ${d.correct})`}
        </div>
      `;
    });
    content += `</div>`;
  }
  
  resultBox.innerHTML = content;
  resultContainer.appendChild(resultBox);
}
