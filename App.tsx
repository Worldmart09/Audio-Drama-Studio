import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ScriptPanel } from './components/ScriptPanel';
import { MixerPanel } from './components/MixerPanel';
import { Character } from './types';
import { generateScript, generateDramaAudio, setManualApiKey, hasValidKey } from './services/geminiService';
import { decodeAudioData, audioBufferToWav, concatenateAudioBuffers, resampleBuffer } from './utils/audioUtils';
import { MessageSquare, Music, Key, ExternalLink, ArrowRight } from 'lucide-react';
import { Button } from './components/Button';

const DEFAULT_SCRIPT = `Narrator: The year is 2085. A neon light flickers in the rain.
Detective: (Sighs) Another night, another mystery.
Robot: Greeting unit online. How may I assist you, Detective?
Detective: Just find me a coffee, Bolt. A hot one.
Robot: Processing request... Coffee capability not found.`;

const App: React.FC = () => {
  // --- API Key Selection State ---
  // Initialize immediately to avoid flash since we now have a default fallback key
  const [hasApiKey, setHasApiKey] = useState(hasValidKey());
  const [manualKeyInput, setManualKeyInput] = useState('');

  useEffect(() => {
    const checkKey = async () => {
      // 1. Check if we already have a manual key in storage or hardcoded
      if (hasValidKey()) {
          setHasApiKey(true);
          return;
      }

      // 2. Try AI Studio injection (if available)
      try {
        if ((window as any).aistudio && (window as any).aistudio.hasSelectedApiKey) {
            const has = await (window as any).aistudio.hasSelectedApiKey();
            if (has) setHasApiKey(true);
        }
      } catch (e) {
          console.error("Error checking API key", e);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
      try {
          if ((window as any).aistudio && (window as any).aistudio.openSelectKey) {
              await (window as any).aistudio.openSelectKey();
              setHasApiKey(true);
          } else {
              alert("Google AI Studio environment not detected. Please paste your key below.");
          }
      } catch (e) {
          console.error("Error selecting key", e);
      }
  };

  const handleManualKeySubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (manualKeyInput.length > 20) {
          setManualApiKey(manualKeyInput.trim());
          setHasApiKey(true);
      } else {
          alert("Please enter a valid API Key.");
      }
  };

  // --- State ---
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [characters, setCharacters] = useState<Character[]>([]);
  
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string>('');
  
  // Mobile View State
  const [mobileTab, setMobileTab] = useState<'script' | 'studio'>('script');

  // Audio Context & State
  const audioContextRef = useRef<AudioContext | null>(null);
  const [speechBuffer, setSpeechBuffer] = useState<AudioBuffer | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  const [speechVolume, setSpeechVolume] = useState(1.0);

  // Audio Nodes refs for realtime control
  const speechSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const speechGainRef = useRef<GainNode | null>(null);
  
  const startTimeRef = useRef<number>(0);
  const pauseOffsetRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  // --- Initialization ---
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    return () => {
      audioContextRef.current?.close();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // --- Handlers ---

  const handleGenerateScript = async (prompt: string, language: string) => {
    setIsGeneratingScript(true);
    try {
      const newScript = await generateScript(prompt, language);
      setScript(newScript);
    } catch (error: any) {
      console.error("Failed to generate script", error);
      alert(`Error generating script: ${error.message}`);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleGenerateAudio = async () => {
    if (!audioContextRef.current) return;
    setIsGeneratingAudio(true);
    setGenerationStatus('Initializing audio generation...');
    // stop if playing
    stopAudio();

    try {
      // Pass the status callback to the service
      const segments = await generateDramaAudio(
          script, 
          characters, 
          (status) => setGenerationStatus(status)
      );
      
      setGenerationStatus('Processing audio & Applying effects...');
      
      if (segments && segments.length > 0) {
        // Map character names to their current pitch settings
        const charPitchMap = new Map<string, number>();
        characters.forEach(c => charPitchMap.set(c.name.toLowerCase(), c.pitch));

        const processedBuffers: AudioBuffer[] = [];

        // Process segments sequentially to maintain order
        for (const segment of segments) {
             const buffer = await decodeAudioData(segment.audio, audioContextRef.current!);
             
             // Find pitch for this speaker
             const pitch = charPitchMap.get(segment.speaker.toLowerCase()) || 1.0;
             
             // Resample if needed
             const finalBuffer = resampleBuffer(buffer, pitch, audioContextRef.current!);
             processedBuffers.push(finalBuffer);
        }
        
        // Stitch them together
        const combinedBuffer = concatenateAudioBuffers(processedBuffers, audioContextRef.current!);
        
        setSpeechBuffer(combinedBuffer);
        setDuration(combinedBuffer.duration);
        pauseOffsetRef.current = 0; // reset
        setCurrentTime(0);
        
        // Auto-switch to studio view on mobile when audio is ready
        setMobileTab('studio');
      } else {
        console.warn("No audio segments generated.");
        alert("Could not generate audio. Ensure script format is 'Name: Text' and all characters are cast.");
      }
    } catch (error: any) {
      console.error("Failed to generate audio", error);
      alert(`Audio Generation Failed: ${error.message}\n\nCheck console for details.`);
    } finally {
      setIsGeneratingAudio(false);
      setGenerationStatus('');
    }
  };

  const playAudio = () => {
    if (!audioContextRef.current || !speechBuffer) return;
    
    const ctx = audioContextRef.current;

    // Create Nodes
    const speechSource = ctx.createBufferSource();
    speechSource.buffer = speechBuffer;
    const speechGain = ctx.createGain();
    
    // Connect Speech
    speechSource.connect(speechGain);
    speechGain.connect(ctx.destination);
    
    speechSourceRef.current = speechSource;
    speechGainRef.current = speechGain;
    speechGain.gain.value = speechVolume;

    // Start
    const offset = pauseOffsetRef.current;
    startTimeRef.current = ctx.currentTime - offset;
    
    speechSource.start(0, offset);

    setIsPlaying(true);
    
    // Animation Loop for UI
    const updateTime = () => {
        if (!ctx) return;
        const now = ctx.currentTime;
        const elapsed = now - startTimeRef.current;
        
        if (elapsed >= speechBuffer.duration) {
            stopAudio();
            pauseOffsetRef.current = 0;
            setCurrentTime(0);
        } else {
            setCurrentTime(elapsed);
            rafRef.current = requestAnimationFrame(updateTime);
        }
    };
    rafRef.current = requestAnimationFrame(updateTime);
    
    speechSource.onended = () => {
       // Handled by time check mainly, but safety net
    };
  };

  const stopAudio = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    
    if (speechSourceRef.current) {
        try { speechSourceRef.current.stop(); } catch(e) {}
        speechSourceRef.current.disconnect();
        speechSourceRef.current = null;
    }
    
    setIsPlaying(false);
  }, []);

  const pauseAudio = () => {
    if (!audioContextRef.current) return;
    stopAudio();
    // Record where we stopped
    pauseOffsetRef.current = currentTime;
  };

  const handleSeek = (time: number) => {
      const wasPlaying = isPlaying;
      if (wasPlaying) stopAudio();
      pauseOffsetRef.current = time;
      setCurrentTime(time);
      if (wasPlaying) playAudio();
  };

  const handleDownload = () => {
      if (!speechBuffer) return;
      const blob = audioBufferToWav(speechBuffer);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'drama_scene_speech.wav';
      a.click();
  };

  // Update gains in realtime
  useEffect(() => {
      if (speechGainRef.current) speechGainRef.current.gain.value = speechVolume;
  }, [speechVolume]);

  // --- API KEY LANDING PAGE ---
  if (!hasApiKey) {
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-gray-800 border border-gray-700 rounded-xl p-8 shadow-2xl space-y-6 text-center">
                <div className="w-16 h-16 bg-indigo-900/50 rounded-full flex items-center justify-center mx-auto mb-4 ring-2 ring-indigo-500/30">
                    <Key className="text-indigo-400" size={32} />
                </div>
                
                <h1 className="text-2xl font-bold text-white">Setup Gemini API</h1>
                
                <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-4 text-sm text-yellow-200/80 text-left">
                    <p className="font-semibold mb-1 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                        Fix Quota & Import Issues
                    </p>
                    <p>
                        Since you have multiple accounts or import issues, please copy the API Key from your <strong>Paid Google Cloud Project</strong> and paste it below.
                    </p>
                </div>

                <div className="space-y-4">
                    <Button onClick={handleSelectKey} className="w-full py-3 text-base shadow-lg shadow-indigo-900/20" variant="secondary">
                        Try Importing Again (Default)
                    </Button>
                    
                    <div className="relative flex py-2 items-center">
                        <div className="flex-grow border-t border-gray-700"></div>
                        <span className="flex-shrink-0 mx-4 text-gray-500 text-xs uppercase">Or Manually Enter</span>
                        <div className="flex-grow border-t border-gray-700"></div>
                    </div>

                    <form onSubmit={handleManualKeySubmit} className="flex flex-col gap-3">
                        <input 
                            type="text" 
                            placeholder="Paste API Key here (starts with AIza...)"
                            value={manualKeyInput}
                            onChange={(e) => setManualKeyInput(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-sm text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                         <Button type="submit" className="w-full py-3 text-base font-bold bg-green-600 hover:bg-green-700">
                            Start App <ArrowRight size={16} className="ml-2" />
                        </Button>
                    </form>
                    
                    <a 
                        href="https://aistudio.google.com/app/apikey" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 text-xs text-gray-500 hover:text-indigo-400 transition-colors mt-4"
                    >
                        Get Key from Google AI Studio <ExternalLink size={10} />
                    </a>
                </div>
            </div>
        </div>
      );
  }

  return (
    <div className="flex flex-col md:flex-row h-[100dvh] w-full overflow-hidden font-sans bg-gray-900">
      {/* Left Panel: Script & Cast */}
      <div className={`
        flex-1 md:flex-none md:w-[450px] flex flex-col h-full overflow-hidden border-b md:border-b-0 md:border-r border-gray-700
        ${mobileTab === 'script' ? 'flex' : 'hidden md:flex'}
      `}>
        <ScriptPanel 
          script={script}
          setScript={setScript}
          characters={characters}
          setCharacters={setCharacters}
          onGenerateScript={handleGenerateScript}
          onGenerateAudio={handleGenerateAudio}
          isGeneratingScript={isGeneratingScript}
          isGeneratingAudio={isGeneratingAudio}
          generationStatus={generationStatus}
        />
      </div>

      {/* Right Panel: Mixing Studio */}
      <div className={`
        flex-1 flex flex-col h-full overflow-hidden
        ${mobileTab === 'studio' ? 'flex' : 'hidden md:flex'}
      `}>
        <MixerPanel 
          audioBuffer={speechBuffer}
          isPlaying={isPlaying}
          onPlayPause={() => isPlaying ? pauseAudio() : playAudio()}
          currentTime={currentTime}
          duration={duration}
          onSeek={handleSeek}
          speechVolume={speechVolume}
          setSpeechVolume={setSpeechVolume}
          onDownload={handleDownload}
        />
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden flex-none h-16 bg-gray-800 border-t border-gray-700 flex justify-around items-center px-2 shadow-lg z-50">
        <button 
          onClick={() => setMobileTab('script')}
          className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${
            mobileTab === 'script' ? 'text-indigo-400 bg-gray-700/50' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <MessageSquare size={20} />
          <span className="text-[10px] font-medium uppercase tracking-wide">Script & Cast</span>
        </button>
        <button 
          onClick={() => setMobileTab('studio')}
          className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${
            mobileTab === 'studio' ? 'text-indigo-400 bg-gray-700/50' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Music size={20} />
          <span className="text-[10px] font-medium uppercase tracking-wide">Studio</span>
        </button>
      </div>
    </div>
  );
};

export default App;