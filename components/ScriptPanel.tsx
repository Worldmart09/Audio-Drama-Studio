import React, { useState, useEffect, useRef } from 'react';
import { Character, VoiceName, AVAILABLE_VOICES, VOICE_META, SUPPORTED_LANGUAGES } from '../types';
import { Button } from './Button';
import { Wand2, Users, PlayCircle, MessageSquare, Globe, Sparkles, Trash2, Info, Play, Loader2, HelpCircle, Lock, Zap } from 'lucide-react';
import { suggestCharacterMapping, generateSpeechPreview, humanizeScript } from '../services/geminiService';
import { parseScriptContent } from '../utils/scriptParsing';
import { decodeAudioData } from '../utils/audioUtils';

interface ScriptPanelProps {
  script: string;
  setScript: React.Dispatch<React.SetStateAction<string>>;
  characters: Character[];
  setCharacters: React.Dispatch<React.SetStateAction<Character[]>>;
  onGenerateScript: (prompt: string, language: string) => Promise<void>;
  onGenerateAudio: () => Promise<void>;
  isGeneratingScript: boolean;
  isGeneratingAudio: boolean;
  generationStatus?: string;
}

// STORAGE KEY
const VOICE_REGISTRY_KEY = 'gemini_drama_voice_registry';

export const ScriptPanel: React.FC<ScriptPanelProps> = ({
  script,
  setScript,
  characters,
  setCharacters,
  onGenerateScript,
  onGenerateAudio,
  isGeneratingScript,
  isGeneratingAudio,
  generationStatus,
}) => {
  const [prompt, setPrompt] = useState('');
  const [language, setLanguage] = useState('English');
  const [activeTab, setActiveTab] = useState<'write' | 'cast'>('write');
  const [isAutoCasting, setIsAutoCasting] = useState(false);
  const [isHumanizing, setIsHumanizing] = useState(false);
  
  // Quota Test State
  const [isTestingQuota, setIsTestingQuota] = useState(false);

  // Preview State
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const previewAudioContextRef = useRef<AudioContext | null>(null);
  
  const previewCache = useRef<Map<string, AudioBuffer>>(new Map());

  const voiceRegistry = useRef<Map<string, { voice: VoiceName, pitch: number }>>((() => {
     try {
         const saved = localStorage.getItem(VOICE_REGISTRY_KEY);
         if (saved) return new Map(JSON.parse(saved));
     } catch (e) {}
     return new Map();
  })());

  const saveRegistry = () => {
      try {
          const arr = Array.from(voiceRegistry.current.entries());
          localStorage.setItem(VOICE_REGISTRY_KEY, JSON.stringify(arr));
      } catch (e) {}
  };

  useEffect(() => {
     if (voiceRegistry.current.size === 0) {
        const saved = localStorage.getItem(VOICE_REGISTRY_KEY);
        if (saved) {
             try {
                const map = new Map<string, {voice: VoiceName, pitch: number}>(JSON.parse(saved));
                if (map.size > 0) voiceRegistry.current = map;
             } catch(e){}
        }
     }
  }, []);

  // Parse characters from script whenever script changes
  useEffect(() => {
    const parsedLines = parseScriptContent(script);
    
    // Group case-insensitively, prefer Title Case for display
    const uniqueMap = new Map<string, string>(); // lowercase key -> display name

    parsedLines.forEach(line => {
      const lower = line.speakerClean.toLowerCase();
      if (!uniqueMap.has(lower)) {
        uniqueMap.set(lower, line.speakerClean);
      } else {
        // If current stored is ALL CAPS and new one is Title Case, overwrite with Title Case
        // e.g. "SHAKTIMAAN" stored, but now we see "Shaktimaan" -> switch to "Shaktimaan"
        const stored = uniqueMap.get(lower)!;
        if (stored === stored.toUpperCase() && line.speakerClean !== line.speakerClean.toUpperCase()) {
             uniqueMap.set(lower, line.speakerClean);
        }
      }
    });
    
    const foundSpeakers = Array.from(uniqueMap.values());

    setCharacters(prev => {
      const newChars: Character[] = [];
      // Use lowercase map for previous lookup too
      const prevMap = new Map<string, Character>();
      prev.forEach(c => prevMap.set(c.name.toLowerCase(), c));
      
      let voiceIndex = 0;
      
      foundSpeakers.forEach(name => {
        const lowerName = name.toLowerCase();
        
        // Check if character existed before (case insensitive)
        if (prevMap.has(lowerName)) {
          const existing = prevMap.get(lowerName)!;
          // Update display name if it changed (e.g. JETHALAL -> Jethalal)
          existing.name = name; 
          
          // Check registry
          // Note: Registry keys are likely the name at the time of saving.
          // We might need to check registry case-insensitively too if possible, 
          // but for now we check exact match or assume user hasn't changed case radically.
          // Let's try to find registry entry case-insensitively
          let regEntry = voiceRegistry.current.get(name);
          if (!regEntry) {
              // try finding via iteration
              for (const [k, v] of voiceRegistry.current.entries()) {
                  if (k.toLowerCase() === lowerName) {
                      regEntry = v;
                      break;
                  }
              }
          }

          if (regEntry) {
              existing.voice = regEntry.voice;
              existing.pitch = regEntry.pitch;
          }
          newChars.push(existing);
        } else {
             // New Character
             // Check registry
             let regEntry = voiceRegistry.current.get(name);
             if (!regEntry) {
                for (const [k, v] of voiceRegistry.current.entries()) {
                    if (k.toLowerCase() === lowerName) {
                        regEntry = v;
                        break;
                    }
                }
             }

             if (regEntry) {
                 newChars.push({
                    id: crypto.randomUUID(),
                    name,
                    voice: regEntry.voice,
                    pitch: regEntry.pitch
                 });
             } else {
                 const defaultVoice = AVAILABLE_VOICES[voiceIndex % AVAILABLE_VOICES.length];
                 const newChar: Character = {
                    id: crypto.randomUUID(),
                    name,
                    voice: defaultVoice,
                    pitch: 1.0
                 };
                 newChars.push(newChar);
                 voiceRegistry.current.set(name, { voice: defaultVoice, pitch: 1.0 });
                 saveRegistry();
                 voiceIndex++;
             }
        }
      });
      return newChars;
    });
  }, [script, setCharacters]);

  const handleVoiceChange = (id: string, newVoice: VoiceName) => {
    setCharacters(prev => {
        return prev.map(c => {
            if (c.id === id) {
                voiceRegistry.current.set(c.name, { voice: newVoice, pitch: c.pitch });
                saveRegistry();
                return { ...c, voice: newVoice };
            }
            return c;
        });
    });
  };

  const handlePitchChange = (id: string, newPitch: number) => {
    setCharacters(prev => {
        return prev.map(c => {
            if (c.id === id) {
                voiceRegistry.current.set(c.name, { voice: c.voice, pitch: newPitch });
                saveRegistry();
                return { ...c, pitch: newPitch };
            }
            return c;
        });
    });
  };

  const handleAutoCast = async () => {
    if (characters.length === 0) return;
    setIsAutoCasting(true);
    try {
      const characterNames = characters.map(c => c.name);
      const mapping = await suggestCharacterMapping(script, characterNames);
      
      setCharacters(prev => prev.map(char => {
        // Try exact match then case insensitive
        let suggestion = mapping[char.name];
        if (!suggestion) {
             const key = Object.keys(mapping).find(k => k.toLowerCase() === char.name.toLowerCase());
             if (key) suggestion = mapping[key];
        }

        if (suggestion && AVAILABLE_VOICES.includes(suggestion.voice as VoiceName)) {
          const newVoice = suggestion.voice as VoiceName;
          const newPitch = Math.max(0.8, Math.min(1.2, suggestion.pitch));
          voiceRegistry.current.set(char.name, { voice: newVoice, pitch: newPitch });
          return { ...char, voice: newVoice, pitch: newPitch };
        }
        return char;
      }));
      saveRegistry();
    } catch (error) {
      console.error("Auto cast failed", error);
    } finally {
      setIsAutoCasting(false);
    }
  };
  
  const handleAutoCastAndSwitch = async () => {
    await handleAutoCast();
    setActiveTab('cast');
  };

  const handleClearRegistry = () => {
      if (confirm("This will forget all saved voice settings for these characters. Are you sure?")) {
        voiceRegistry.current.clear();
        localStorage.removeItem(VOICE_REGISTRY_KEY);
        setScript(prev => prev + " "); 
        setTimeout(() => setScript(prev => prev.trimEnd()), 50);
      }
  };

  const handleHumanize = async () => {
      if (!script.trim()) return;
      setIsHumanizing(true);
      try {
          const newScript = await humanizeScript(script);
          setScript(newScript);
      } catch(e) {
          console.error("Humanize failed", e);
      } finally {
          setIsHumanizing(false);
      }
  };

  const handleTestQuota = async () => {
      setIsTestingQuota(true);
      try {
          // Attempt a fast burst of previews to see if we hit a limit
          const testPromises = Array(4).fill(0).map((_, i) => 
              generateSpeechPreview(`Test sequence ${i}`, 'Puck')
          );
          
          await Promise.all(testPromises);
          alert("✅ Success! Your API Key handled a burst of requests. It appears to be working correctly (likely Paid Tier or not currently throttled).");
      } catch (e: any) {
          const msg = e.message?.toLowerCase() || "";
          if (msg.includes('429') || msg.includes('quota')) {
              alert("❌ Quota Exceeded (Free Tier Detected).\n\nThe API blocked the request. You are definitely on the Free Tier limits. Please ensure your GCP Project is linked to your Billing Account.");
          } else {
              alert("⚠️ Test Failed (Connection Error). Please check your internet.");
          }
      } finally {
          setIsTestingQuota(false);
      }
  };

  const handlePreview = async (char: Character) => {
    if (previewLoadingId) return; 
    setPreviewLoadingId(char.id);

    try {
        if (!previewAudioContextRef.current) {
            previewAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = previewAudioContextRef.current;
        if (ctx.state === 'suspended') await ctx.resume();

        const parsed = parseScriptContent(script);
        const line = parsed.find(l => l.speakerClean.toLowerCase() === char.name.toLowerCase());
        
        const textToSpeak = line 
             ? line.dialogue.slice(0, 100) 
             : `This is the voice of ${char.name}.`;

        const cacheKey = `${char.voice}-${textToSpeak.trim()}`;

        let buffer: AudioBuffer;

        if (previewCache.current.has(cacheKey)) {
            console.log("Serving preview from cache (Quota Saved!)");
            buffer = previewCache.current.get(cacheKey)!;
        } else {
            const base64 = await generateSpeechPreview(textToSpeak, char.voice);
            buffer = await decodeAudioData(base64, ctx);
            previewCache.current.set(cacheKey, buffer);
        }
        
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = char.pitch; 
        source.connect(ctx.destination);
        source.start();
        
    } catch (e: any) {
        console.error("Preview failed", e);
        const msg = e.message || JSON.stringify(e);
        if (msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('429')) {
             alert("⚠️ Quota Exceeded.\n\nPlease wait 30 seconds. To fix this permanently, use a Paid API Key.");
        } else {
             alert("Failed to play preview. Please check your connection.");
        }
    } finally {
        setPreviewLoadingId(null);
    }
  };

  const getPitchLabel = (pitch: number) => {
      if (pitch < 0.85) return "Giant/Villain";
      if (pitch < 0.95) return "Deep/Serious";
      if (pitch > 1.15) return "Child/Sidekick";
      if (pitch > 1.05) return "Young/Energetic";
      return "Natural";
  }

  return (
    <div className="flex flex-col h-full bg-gray-800 border-r border-gray-700">
      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setActiveTab('write')}
          className={`flex-1 py-3 font-medium text-sm flex items-center justify-center gap-2 touch-manipulation ${
            activeTab === 'write' ? 'text-indigo-400 border-b-2 border-indigo-400 bg-gray-800' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-750'
          }`}
        >
          <MessageSquare size={16} /> Script
        </button>
        <button
          onClick={() => setActiveTab('cast')}
          className={`flex-1 py-3 font-medium text-sm flex items-center justify-center gap-2 touch-manipulation ${
            activeTab === 'cast' ? 'text-indigo-400 border-b-2 border-indigo-400 bg-gray-800' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-750'
          }`}
        >
          <Users size={16} /> Cast ({characters.length})
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'write' ? (
          <div className="flex-1 flex flex-col p-3 md:p-4 space-y-3 md:space-y-4 overflow-y-auto">
            <div className="bg-gray-900/50 p-3 md:p-4 rounded-lg border border-gray-700 space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">AI Assist</label>
                <div className="flex items-center gap-2">
                   <Globe size={12} className="text-gray-500"/>
                   <select 
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="bg-transparent text-xs text-gray-400 border-none outline-none focus:ring-0 cursor-pointer hover:text-gray-200"
                   >
                      {SUPPORTED_LANGUAGES.map(lang => (
                        <option key={lang.code} value={lang.name} className="bg-gray-800">{lang.name}</option>
                      ))}
                   </select>
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. A debate between a human and a robot..."
                  className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500 outline-none w-0"
                  onKeyDown={(e) => e.key === 'Enter' && prompt && onGenerateScript(prompt, language)}
                />
                <Button 
                  size="sm" 
                  onClick={() => onGenerateScript(prompt, language)} 
                  disabled={!prompt}
                  isLoading={isGeneratingScript}
                  className="shrink-0"
                >
                  <Wand2 size={16} />
                </Button>
              </div>
            </div>

            <div className="flex-1 flex flex-col space-y-2">
               <div className="flex justify-between items-end border-b border-gray-700 pb-2 mb-1">
                   <div>
                       <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 block">
                         Script Editor
                       </label>
                   </div>
                   <div className="flex gap-2">
                        <Button 
                            size="sm" 
                            variant="secondary" 
                            onClick={handleHumanize}
                            disabled={!script.trim()}
                            className="text-xs py-1 h-7 whitespace-nowrap text-indigo-300 border-indigo-900/50 hover:bg-indigo-900/20"
                            isLoading={isHumanizing}
                            title="Rewrites script to include stutters, laughs, and natural emotions."
                        >
                            <Sparkles size={12} className="mr-1.5" />
                            Make Realistic
                        </Button>
                        <Button 
                            size="sm" 
                            variant="secondary" 
                            onClick={handleAutoCastAndSwitch}
                            disabled={!script.trim() || characters.length === 0}
                            className="text-xs py-1 h-7 whitespace-nowrap"
                            isLoading={isAutoCasting}
                        >
                            <Users size={12} className="mr-1.5" />
                            Auto-Cast
                        </Button>
                   </div>
               </div>
              <textarea
                className="flex-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-3 md:p-4 font-mono text-sm leading-relaxed text-gray-300 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder={`Script Example:
Narrator: The sun rose over the horizon.
Hero: I will find the treasure today!`}
                spellCheck={false}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 p-3 md:p-4 overflow-y-auto">
             <div className="space-y-4">
               {characters.length > 0 && (
                 <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700 flex flex-col gap-2">
                   <div className="flex justify-between items-center">
                       <div className="text-xs text-gray-400">
                         <p className="font-semibold text-gray-300">Voice Casting</p>
                         <p className="text-[10px] md:text-xs">Changes are <span className="text-green-400 font-bold">auto-locked</span>.</p>
                       </div>
                       <div className="flex gap-2">
                            <Button 
                                size="sm" 
                                variant="secondary"
                                onClick={handleTestQuota}
                                className="text-xs text-blue-300 border-blue-900/50 hover:bg-blue-900/20 px-2"
                                title="Check if your API key is Paid or Free"
                                isLoading={isTestingQuota}
                            >
                                <Zap size={14} className="mr-1" /> Test Quota
                            </Button>
                            <Button 
                                size="sm" 
                                variant="secondary"
                                onClick={handleClearRegistry}
                                className="text-xs text-red-300 border-red-900/50 hover:bg-red-900/20 px-2"
                                title="Reset all voice memories"
                            >
                                <Trash2 size={14} />
                            </Button>
                           <Button 
                             size="sm" 
                             variant="secondary"
                             onClick={handleAutoCast}
                             isLoading={isAutoCasting}
                             className="text-xs px-2"
                           >
                             <Sparkles size={14} className="mr-1.5 text-yellow-400" />
                             Auto
                           </Button>
                       </div>
                   </div>
                 </div>
               )}

               {characters.length === 0 ? (
                 <div className="text-center text-gray-500 py-10">
                   <Users className="mx-auto mb-2 opacity-50" size={32} />
                   <p>No characters found.</p>
                   <p className="text-sm">Write a script first.</p>
                 </div>
               ) : (
                 characters.map((char) => {
                   const meta = VOICE_META[char.voice];
                   const isPreviewLoading = previewLoadingId === char.id;
                   const pitchLabel = getPitchLabel(char.pitch);
                   const isLocked = voiceRegistry.current.has(char.name);
                   
                   return (
                     <div key={char.id} className="bg-gray-700/50 rounded-lg p-2 md:p-3 border border-gray-600 space-y-2 relative group">
                       <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2 md:gap-3 overflow-hidden">
                           <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border ${
                               meta.gender === 'Male' ? 'bg-blue-900/50 border-blue-500/30 text-blue-400' : 'bg-pink-900/50 border-pink-500/30 text-pink-400'
                           }`}>
                             {char.name.substring(0, 2).toUpperCase()}
                           </div>
                           <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="font-medium text-gray-200 truncate">{char.name}</span>
                                    {isLocked && <span title="Voice Locked"><Lock size={10} className="text-green-500" /></span>}
                                </div>
                                <span className="text-[10px] text-gray-400">
                                    {isLocked ? 'Settings Saved' : 'New'}
                                </span>
                           </div>
                         </div>
                         <Button
                            size="sm"
                            variant="secondary"
                            className="shrink-0 h-7 px-2 text-[10px] flex gap-1"
                            onClick={() => handlePreview(char)}
                            disabled={!!previewLoadingId}
                         >
                            {isPreviewLoading ? (
                                <Loader2 size={12} className="animate-spin" />
                            ) : (
                                <Play size={12} fill="currentColor" />
                            )}
                            Sample
                         </Button>
                       </div>
                       
                       <div className="grid grid-cols-2 gap-2 md:gap-3">
                           <div className="flex flex-col gap-1">
                              <label className="text-[10px] uppercase text-gray-500 font-semibold">Voice</label>
                              <select
                                value={char.voice}
                                onChange={(e) => handleVoiceChange(char.id, e.target.value as VoiceName)}
                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
                              >
                                {AVAILABLE_VOICES.map(v => (
                                  <option key={v} value={v}>
                                    {v} ({VOICE_META[v].gender})
                                  </option>
                                ))}
                              </select>
                           </div>
                           
                           <div className="flex flex-col gap-1">
                                <label className="text-[10px] uppercase text-gray-500 font-semibold flex items-center justify-between whitespace-nowrap">
                                    <span>Tone</span>
                                    <span className="text-indigo-400 text-[10px] font-normal truncate ml-1">{pitchLabel}</span>
                                </label>
                                <div className="flex items-center gap-2 h-7">
                                   <input 
                                     type="range"
                                     min="0.8"
                                     max="1.2"
                                     step="0.05"
                                     value={char.pitch}
                                     onChange={(e) => handlePitchChange(char.id, parseFloat(e.target.value))}
                                     className="w-full h-1.5 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-400"
                                     title="Lower for deeper/slower, Higher for lighter/faster"
                                   />
                                </div>
                           </div>
                       </div>
                     </div>
                   );
                 })
               )}
             </div>
          </div>
        )}
      </div>

      <div className="p-3 md:p-4 border-t border-gray-700 bg-gray-800">
        <Button 
          className="w-full" 
          onClick={onGenerateAudio} 
          disabled={!script.trim() || characters.length < 1}
          isLoading={isGeneratingAudio}
        >
          <PlayCircle size={18} className="mr-2" />
          Generate Scene
        </Button>
        {isGeneratingAudio && generationStatus && (
            <div className={`mt-3 px-3 py-2 rounded text-xs font-mono text-center transition-colors duration-300 border ${
               generationStatus.includes('Rate limit') 
               ? 'bg-yellow-900/30 text-yellow-200 border-yellow-500/30 animate-pulse' 
               : 'bg-indigo-900/30 text-indigo-200 border-indigo-500/30'
            }`}>
               <div className="flex items-center justify-center gap-2">
                 {generationStatus.includes('Rate limit') && <Info size={14} />}
                 {generationStatus}
               </div>
            </div>
        )}
      </div>
    </div>
  );
};