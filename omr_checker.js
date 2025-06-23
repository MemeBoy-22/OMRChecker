let answerKey = [];

document.getElementById("keyFile").addEventListener("change", function () {
  const reader = new FileReader();
  reader.onload = e => {
    const content = e.target.result.trim();
    answerKey = content.startsWith("[")
      ? JSON.parse(content)
      : content.split("\n").map(x => x.trim()).filter(x => x);
    alert("Answer key loaded!");
  };
  reader.readAsText(this.files[0]);
});

function checkOMR() {
  const files = document.getElementById("sheetImage").files;
  const resultDiv = document.getElementById("result");
  resultDiv.innerHTML = "";

  if (files.length === 0 || answerKey.length === 0) {
    alert("Please upload both answer key and image(s).");
    return;
  }

  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");

  [...files].forEach((file, idx) => {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      let src = cv.imread("canvas");
      const { score, answers, id } = processOMR(src);
      src.delete();

      resultDiv.innerHTML += `
        <div class="result-box">
          <strong>Sheet ${idx + 1}</strong><br>
          <strong>ID:</strong> ${id} |
          <strong>Score:</strong> ${score}/${answerKey.length}<br>
          <strong>Answers:</strong> ${answers.join(" ")}
        </div>`;
    };
    img.src = URL.createObjectURL(file);
  });
}

function processOMR(src) {
  const gray = new cv.Mat(),
        thresh = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 15, 10);

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
    bubbleAnswers.push(["A","B","C","D","E"][marked]);
  }

  // Score
  let score = bubbleAnswers.reduce((acc, ans, i) =>
    acc + (ans === (answerKey[i] || "").toUpperCase()), 0);

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

  gray.delete(); thresh.delete();

  return {
    score,
    answers: bubbleAnswers,
    id: idDigits.join("")
  };
}
