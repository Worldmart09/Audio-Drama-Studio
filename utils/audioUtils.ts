// Utility to decode base64 audio string (Raw PCM 16-bit, 24kHz)
export const decodeAudioData = async (
  base64Data: string,
  audioContext: AudioContext
): Promise<AudioBuffer> => {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // Gemini 2.5 Flash TTS returns raw PCM: 24kHz, 1 channel, 16-bit signed integer
  const sampleRate = 24000;
  const numChannels = 1;
  
  // Ensure we have an even number of bytes for 16-bit array
  if (bytes.length % 2 !== 0) {
      // console.warn("Audio data length is odd, truncating last byte.");
  }

  const dataInt16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
  const frameCount = dataInt16.length / numChannels;
  const buffer = audioContext.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Convert int16 to float32 range [-1.0, 1.0]
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  
  return buffer;
};

// Resample audio buffer to change pitch/speed (Simple Linear Interpolation)
export const resampleBuffer = (buffer: AudioBuffer, rate: number, context: AudioContext): AudioBuffer => {
    if (rate === 1.0) return buffer;
    
    // rate > 1.0 = Faster/Higher (Shorter duration)
    // rate < 1.0 = Slower/Deeper (Longer duration)
    const newLength = Math.round(buffer.length / rate);
    const newBuffer = context.createBuffer(buffer.numberOfChannels, newLength, buffer.sampleRate);
    
    for (let c = 0; c < buffer.numberOfChannels; c++) {
        const input = buffer.getChannelData(c);
        const output = newBuffer.getChannelData(c);
        for (let i = 0; i < newLength; i++) {
            const position = i * rate;
            const index = Math.floor(position);
            const fraction = position - index;
            
            if (index >= input.length - 1) {
                output[i] = input[input.length - 1];
            } else {
                // Linear interpolation
                output[i] = input[index] * (1 - fraction) + input[index + 1] * fraction;
            }
        }
    }
    return newBuffer;
};

// Simple utility to format time
export const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Concatenate multiple AudioBuffers into one
export const concatenateAudioBuffers = (buffers: AudioBuffer[], context: AudioContext): AudioBuffer => {
    if (buffers.length === 0) return context.createBuffer(1, 1, context.sampleRate);
    
    const totalLength = buffers.reduce((acc, b) => acc + b.length, 0);
    // Use the channel count of the first buffer, typically 1 for TTS
    const numberOfChannels = buffers[0].numberOfChannels; 
    // Use the sample rate of the first buffer (should be 24000)
    const result = context.createBuffer(numberOfChannels, totalLength, buffers[0].sampleRate);

    let offset = 0;
    for (const buffer of buffers) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
             const resultData = result.getChannelData(channel);
             if (channel < buffer.numberOfChannels) {
                resultData.set(buffer.getChannelData(channel), offset);
             } else if (buffer.numberOfChannels === 1) {
                // Upmix mono to this channel if needed
                resultData.set(buffer.getChannelData(0), offset);
             }
        }
        offset += buffer.length;
    }
    return result;
};

// Create a WAV file from an AudioBuffer (for download)
export const audioBufferToWav = (buffer: AudioBuffer): Blob => {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArray = new ArrayBuffer(length);
  const view = new DataView(bufferArray);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // write WAVE header
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded in this example)

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // write interleaved data
  for (i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while (pos < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
      view.setInt16(44 + offset, sample, true); // write 16-bit sample
      offset += 2;
    }
    pos++;
  }

  return new Blob([bufferArray], { type: 'audio/wav' });

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
};