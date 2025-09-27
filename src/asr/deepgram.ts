import { log } from '../utils/logger.js';

/**
 * Transcribe a single audio buffer (webm/ogg/wav) to text using Deepgram's HTTPS API.
 * Returns transcript text and ASR confidence.
 */
export async function transcribeBuffer(buf: Buffer): Promise<{ text: string; confidence: number }> {
  // Build the API URL with the model and options you want.
  const url = new URL('https://api.deepgram.com/v1/listen');
  url.searchParams.set('model', 'nova-2');        // high-quality model
  url.searchParams.set('smart_format', 'true');   // punctuation, casing, etc.
  url.searchParams.set('punctuate', 'true');

  // Send the audio bytes directly. Content-Type must match your recording format.
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      'Content-Type': 'audio/webm',               // change if you send wav/ogg
    },
    body: buf,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Deepgram STT error ${res.status}: ${errText}`);
  }

  // Deepgram returns JSON with channels/alternatives arrays.
  const json: any = await res.json();
  const alt = json?.results?.channels?.[0]?.alternatives?.[0];
  const text = alt?.transcript ?? '';
  const confidence = alt?.confidence ?? 0;

  log('ASR transcript:', text, 'confidence:', confidence);
  return { text, confidence };
}
