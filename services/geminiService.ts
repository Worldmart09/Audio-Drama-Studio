import { GoogleGenAI, Modality } from "@google/genai";
import { Character, AudioSegment, VOICE_META, VoiceName } from "../types";
import { parseScriptContent } from "../utils/scriptParsing";

// Allow manual override of the key
// Pre-filled with user provided key to bypass setup
let manualApiKey: string | null = 'AIzaSyB00Mln_uAvT1NRJa2dRa932I76dzqq5AE';

// Try to load from storage on init
try {
    const saved = localStorage.getItem('GEMINI_CUSTOM_API_KEY');
    if (saved) manualApiKey = saved;
} catch(e) {}

export const setManualApiKey = (key: string) => {
    manualApiKey = key;
    localStorage.setItem('GEMINI_CUSTOM_API_KEY', key);
};

export const hasValidKey = (): boolean => {
    return !!(manualApiKey || process.env.API_KEY);
};

const getAI = () => {
    // PRIORITIZE the manually pasted key if it exists
    const apiKey = manualApiKey || process.env.API_KEY;
    
    if (!apiKey) {
      throw new Error("API Key not found. Please select or paste a key.");
    }
    
    // Debug helper to verify which key is loaded (safe, only logs prefix)
    if (!(window as any)._hasLoggedKey) {
        console.log(`[Gemini Service] Loaded API Key: ${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`);
        (window as any)._hasLoggedKey = true;
    }
    return new GoogleGenAI({ apiKey });
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Robust wrapper to handle Rate Limits (429) for single requests.
 * Retries up to 5 times with exponential backoff.
 */
const callWithRetry = async <T>(
    operationName: string,
    apiCall: () => Promise<T>,
    maxRetries = 5
): Promise<T> => {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            return await apiCall();
        } catch (error: any) {
            const msg = (error.message || JSON.stringify(error)).toLowerCase();
            const isQuotaError = msg.includes('429') || msg.includes('quota') || msg.includes('exhausted') || msg.includes('overloaded');

            if (isQuotaError) {
                retries++;
                if (retries >= maxRetries) throw error;

                // Aggressive Backoff: 3s, 6s, 12s, 24s, 48s
                const waitTime = 3000 * Math.pow(2, retries - 1); 
                console.warn(`[${operationName}] Rate limit hit. Retrying in ${waitTime/1000}s... (Attempt ${retries}/${maxRetries})`);
                await delay(waitTime);
                continue;
            }
            // Non-quota errors throw immediately
            throw error;
        }
    }
    throw new Error(`${operationName} failed after max retries.`);
};

export const generateScript = async (prompt: string, language: string): Promise<string> => {
  const ai = getAI();
  const model = "gemini-2.5-flash"; 
  
  const systemInstruction = `You are an expert screenwriter for audio dramas.
  Task: Write a short, emotionally engaging scene based on the user's prompt.
  
  Critical Rules for "Natural Human" Dialogue:
  1. Language: ${language}.
  2. Format: "Speaker Name: Dialogue".
  3. Style: HIGHLY CONVERSATIONAL. Use:
     - Stutters/Hesitations ("Um...", "I... I don't know")
     - Interjections ("Oh!", "Pfft.", "Aha!")
     - Emphasis (Use CAPS for loud parts, italics/underscores for stress)
  4. Length: Keep it under 25 lines.
  5. Characters: Use distinct names.
  6. Emotions: Write the dialogue so the emotion is obvious in the words themselves.
  `;

  return callWithRetry("Generate Script", async () => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { systemInstruction }
      });
      return response.text || "";
  });
};

export const humanizeScript = async (script: string): Promise<string> => {
    const ai = getAI();
    const model = "gemini-2.5-flash";

    const systemInstruction = `You are a Dialogue Doctor. Your job is to take a script and make it sound like REAL people talking, not robots.
    
    Instructions:
    1. Keep the exact same plot and speakers.
    2. Add natural "fillers" like: "Um...", "Uh", "You know", "Like", "I mean".
    3. Add "micro-actions" in text: "(laughs)", "(sighs)", "(whispers)".
    4. Add stutters for nervousness: "W-what do you mean?"
    5. Add interjections: "Pfft!", "Ugh.", "Whoa!"
    6. Keep the format "Speaker: Dialogue".
    7. Do NOT make it too long, just rewrite the existing lines to be more human.
    `;

    return callWithRetry("Humanize Script", async () => {
        const response = await ai.models.generateContent({
            model,
            contents: `Humanize this script:\n\n${script}`,
            config: { systemInstruction }
        });
        return response.text || script;
    });
};

export const suggestCharacterMapping = async (
  script: string, 
  characterNames: string[]
): Promise<Record<string, { voice: string, pitch: number }>> => {
  const ai = getAI();
  const model = "gemini-2.5-flash";

  const voiceDescriptions = `
  - Puck: Male, High-pitched, energetic, mischievous.
  - Charon: Male, Low-pitched, deep, authoritative.
  - Kore: Female, Soft, gentle, soothing.
  - Fenrir: Male, Gruff, rough, intense.
  - Zephyr: Female, Professional, confident, clear.
  `;

  const prompt = `
  Analyze the provided script and character names to determine the likely archetype, gender, age, and personality of each character.
  Then, map each character to the best available Voice AND a specific Pitch (Tone) multiplier.
  
  Script Excerpt: "${script.slice(0, 1500)}..."
  
  Characters to Map: ${characterNames.join(', ')}
  
  Available Voices: ${voiceDescriptions}
  
  PITCH RULES (Range 0.8 to 1.2):
  - 0.80 - 0.85: Giants, Monsters, Very Deep Villains.
  - 0.90 - 0.95: Serious Adults, Tough Guys, Authority Figures.
  - 1.00: Normal / Natural Adult.
  - 1.05 - 1.10: Young Adults, Energetic, High Energy.
  - 1.15 - 1.20: Children, Small Creatures, Nervous/Sidekicks.

  Return JSON only:
  { 
    "CharacterName": { "voice": "VoiceName", "pitch": 0.95 },
    ...
  }
  `;

  return callWithRetry("Auto Cast", async () => {
      const response = await ai.models.generateContent({
          model, 
          contents: prompt, 
          config: { responseMimeType: "application/json" }
      });
      let text = response.text || "{}";
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(text);
  });
};

export const generateSpeechPreview = async (
    text: string,
    voice: string
): Promise<string> => {
    const ai = getAI();
    return callWithRetry("Speech Preview", async () => {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text }] }],
            config: {
                responseModalities: ['AUDIO' as Modality],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voice }
                    }
                }
            }
        });
        const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!audioData) throw new Error("No audio data returned for preview");
        return audioData;
    });
};

export const generateDramaAudio = async (
  script: string,
  characters: Character[],
  onProgress?: (status: string) => void
): Promise<AudioSegment[]> => {
  const ai = getAI();
  const rawLines = parseScriptContent(script);
  
  // 1. Group consecutive lines by the same speaker
  const segments: { speaker: string; text: string }[] = [];
  
  if (rawLines.length === 0) return [];

  let currentSegment = { 
      speaker: rawLines[0].speakerClean, 
      text: rawLines[0].dialogue 
  };

  for (let i = 1; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (line.speakerClean === currentSegment.speaker) {
          currentSegment.text += " " + line.dialogue;
      } else {
          segments.push(currentSegment);
          currentSegment = { 
              speaker: line.speakerClean, 
              text: line.dialogue 
          };
      }
  }
  segments.push(currentSegment);

  // 2. Map speakers
  const voiceMap = new Map<string, VoiceName>();
  characters.forEach(c => voiceMap.set(c.name.toLowerCase(), c.voice));

  const audioResults: AudioSegment[] = [];

  console.log(`Starting audio generation for ${segments.length} segments...`);
  if (onProgress) onProgress(`Starting generation for ${segments.length} segments...`);

  // 3. Logic Configuration
  // GEMINI FREE TIER IS ~15 RPM. 
  // 60s / 15 = 4s. 
  // We use 6000ms (6s) to be ultra-safe and avoid any overlapping burst windows.
  let currentDelay = 6000; 

  for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const voice = voiceMap.get(segment.speaker.toLowerCase());
      
      if (!voice) {
          throw new Error(`Speaker "${segment.speaker}" is in the script but not assigned a voice. Please use 'Auto-Assign Voices' first.`);
      }

      const voiceTraits = VOICE_META[voice].traits;
      
      // DIRECTOR MODE: Inject System Instructions for Acting
      const systemInstruction = `
      You are a professional voice actor playing the character: ${segment.speaker}.
      Your voice persona is: ${voiceTraits}.
      
      DIRECTION:
      - This is an Audio Drama. Do not just read the text, ACT IT OUT.
      - Pay close attention to punctuation: "..." means hesitation, "!" means shouting/excitement.
      - If the text says "I... I don't know", perform the stutter naturally.
      - If the text implies sarcasm, be sarcastic.
      - DO NOT read the speaker name. Speak ONLY the dialogue.
      `;

      // We clean the text but keep punctuation which drives the TTS emotion
      const cleanText = segment.text.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
      if (!cleanText) continue;

      let retries = 0;
      let success = false;
      const MAX_RETRIES = 10; // Increased retries for stability
      
      while (!success && retries < MAX_RETRIES) {
          try {
              const statusMsg = `Directing Actor for ${segment.speaker} (Part ${i+1}/${segments.length})...`;
              console.log(statusMsg);
              if (onProgress) onProgress(statusMsg);
              
              const response = await ai.models.generateContent({
                  model: "gemini-2.5-flash-preview-tts",
                  contents: [{ parts: [{ text: cleanText }] }],
                  config: {
                      systemInstruction, // Inject the Director's note
                      responseModalities: ['AUDIO' as Modality],
                      speechConfig: {
                          voiceConfig: {
                              prebuiltVoiceConfig: { voiceName: voice }
                          }
                      }
                  }
              });

              const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
              if (!audioData) throw new Error("API returned empty audio data");
              
              audioResults.push({
                  audio: audioData,
                  speaker: segment.speaker
              });
              success = true;
              
              if (i < segments.length - 1) {
                  await delay(currentDelay); 
              }

          } catch (error: any) {
              const msg = (error.message || JSON.stringify(error)).toLowerCase();
              
              if (msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted') || msg.includes('overloaded') || msg.includes('503')) {
                  retries++;
                  
                  // DRASTIC THROTTLE IF HIT
                  // If we hit limits, it means 6s wasn't enough, or previous usage ate the quota.
                  // We jump to 15s delay (4 RPM) to guarantee recovery.
                  if (currentDelay < 15000) {
                      currentDelay = 15000; 
                      console.warn("Rate Limit Detected: Downgrading to Ultra-Safe Mode (4 RPM).");
                  }
                  
                  // Backoff logic for this specific retry
                  // Wait 10s, 20s, 30s...
                  const waitTime = 10000 * retries; 
                  
                  const end = Date.now() + waitTime;
                  while (Date.now() < end) {
                      const remaining = Math.ceil((end - Date.now()) / 1000);
                      const retryMsg = `⚠️ Rate limited. Waiting for quota... ${remaining}s`;
                      if (onProgress) onProgress(retryMsg);
                      await delay(1000); 
                  }

              } else {
                  console.error("Fatal Audio Error:", error);
                  throw error; 
              }
          }
      }
      
      if (!success) {
           throw new Error(`Failed to generate audio for ${segment.speaker}. Rate Limit persistently exceeded. Please try again in a few minutes or use a Paid API Key.`);
      }
  }

  return audioResults;
};