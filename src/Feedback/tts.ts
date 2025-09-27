import fs from 'node:fs/promises';

/**
 * Convert text → MP3 using Deepgram Aura TTS via HTTPS.
 * Returns a local file path that the client can play.
 */
export async function synthesize(text: string): Promise<string> {
  // Choose a Deepgram Aura voice (or set via .env)
    const model = process.env.DEEPGRAM_TTS_MODEL || 'aura-asteria-en';

    // Build the speak endpoint with the model
    const url = new URL('https://api.deepgram.com/v1/speak');
    url.searchParams.set('model', model);

    // Call Deepgram TTS
    const res = await fetch(url, {
        method: 'POST',
        headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'audio/mp3', // ask for mp3 audio back
        },
        body: JSON.stringify({ text }),
    });

    // Check for HTTP errors and surface the response text for debugging
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Deepgram TTS error ${res.status}: ${errText}`);
    }

    // Convert the binary audio response to a Buffer and save it
    const arrayBuf = await res.arrayBuffer();
    const bytes = Buffer.from(arrayBuf);
    const filePath = `tts-${Date.now()}.mp3`;
    await fs.writeFile(filePath, bytes);

    return filePath;
}
