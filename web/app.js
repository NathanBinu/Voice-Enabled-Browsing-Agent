
const recordBtn = document.getElementById('recordBtn');
const runBtn = document.getElementById('runBtn');
const transcriptEl = document.getElementById('transcript');
const ttsAudio = document.getElementById('tts');
const cmdPre = document.getElementById('cmd');
const resultPre = document.getElementById('result');

let mediaRecorder, chunks = [], transcript = '';

// Start/stop recording from the user's mic.
recordBtn.onclick = async () => {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    // Ask permission for mic.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Record to WebM (works in modern browsers).
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    chunks = [];

    // Accumulate chunks.
    mediaRecorder.ondataavailable = e => chunks.push(e.data);

    // When user stops recording, send to backend for STT.
    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const fd = new FormData();
      fd.append('audio', blob, 'speech.webm');

      // Call our ASR endpoint.
      const r = await fetch('/api/asr/transcribe', { method: 'POST', body: fd });
      const data = await r.json();

      // Show transcript and enable the Run button if we have text.
      transcript = data.transcript || '';
      transcriptEl.textContent = transcript || '–';
      runBtn.disabled = !transcript;
    };

    // Begin recording.
    mediaRecorder.start();
    recordBtn.textContent = '⏹ Stop';
  } else {
    // Stop recording; triggers onstop → upload to server.
    mediaRecorder.stop();
    recordBtn.textContent = '🎤 Start / Stop';
  }
};

// Full pipeline: Parse → (maybe) Confirm → Execute → TTS.
runBtn.onclick = async () => {
  cmdPre.textContent = 'Parsing…';

  // 1) Turn transcript into Command JSON via LLM.
  const p = await fetch('/api/agent/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ utterance: transcript })
  });
  const cmd = await p.json();
  cmdPre.textContent = JSON.stringify(cmd, null, 2);

  // 2) Execute (server uses confidenceGate to ask for confirmation if needed).
  const ex = await fetch('/api/agent/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const data = await ex.json();

  // If low confidence: server returns status=confirm → show message and stop.
  if (data.status === 'confirm') {
    resultPre.textContent =
      `CONFIRMATION NEEDED:\n${data.paraphrase}\n` +
      `Click "Run Agent" again to confirm or re-record a clearer request.`;
    return;
  }

  // If too many retries: show graceful exit text.
  if (data.status === 'retry-limit') {
    resultPre.textContent = `RETRY LIMIT:\n${data.message}`;
    return;
  }

  // Otherwise, show artifacts and play TTS summary.
  resultPre.textContent = JSON.stringify(data, null, 2);
  if (data.tts) {
    ttsAudio.src = data.tts;
    ttsAudio.play();
  }
};
