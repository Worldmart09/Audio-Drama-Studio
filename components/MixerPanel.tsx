import React, { useRef, useEffect, useState } from 'react';
import { Play, Pause, Download, Volume2, Music } from 'lucide-react';
import { Button } from './Button';
import { formatTime } from '../utils/audioUtils';

interface MixerPanelProps {
  audioBuffer: AudioBuffer | null;
  isPlaying: boolean;
  onPlayPause: () => void;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  speechVolume: number;
  setSpeechVolume: (vol: number) => void;
  onDownload: () => void;
}

export const MixerPanel: React.FC<MixerPanelProps> = ({
  audioBuffer,
  isPlaying,
  onPlayPause,
  currentTime,
  duration,
  onSeek,
  speechVolume,
  setSpeechVolume,
  onDownload
}) => {
  const progressBarRef = useRef<HTMLDivElement>(null);
  
  // Fake visualization data
  const [bars, setBars] = useState<number[]>([]);
  
  useEffect(() => {
    if (audioBuffer) {
      const b = Array.from({ length: 40 }, () => Math.random() * 0.8 + 0.2);
      setBars(b);
    } else {
      setBars([]);
    }
  }, [audioBuffer]);

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !duration) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    onSeek(percentage * duration);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="flex-none px-4 md:px-6 py-3 md:py-4 border-b border-gray-800 flex justify-between items-center bg-gray-900">
        <div>
            <h2 className="text-base md:text-lg font-semibold text-white">Audio Player</h2>
            <p className="text-xs text-gray-500 hidden md:block">Listen to your generated drama scene</p>
        </div>
        <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onDownload} disabled={!audioBuffer}>
                <Download size={16} className="md:mr-2" /> <span className="hidden md:inline">Export .WAV</span>
            </Button>
        </div>
      </div>

      {/* Main Visualization Area */}
      <div className="flex-1 p-2 md:p-8 flex flex-col items-center justify-center relative bg-gradient-to-b from-gray-900 to-gray-800 min-h-0">
         {!audioBuffer ? (
             <div className="text-gray-600 flex flex-col items-center text-center p-4">
                 <Music size={48} className="mb-4 opacity-20" />
                 <p className="font-medium">No audio generated yet.</p>
                 <p className="text-sm mt-1">Generate a scene in the Script tab.</p>
             </div>
         ) : (
             <div className="w-full max-w-3xl space-y-4 md:space-y-8 flex flex-col justify-end h-full md:h-auto pb-4 px-2">
                 {/* Visualizer */}
                 <div className="flex-1 md:h-32 flex items-end justify-center gap-1 min-h-[100px]">
                    {bars.map((height, i) => (
                        <div 
                            key={i} 
                            className={`flex-1 max-w-[12px] rounded-t-sm transition-all duration-300 ${
                                (i / bars.length) * 100 < progressPercent ? 'bg-indigo-500' : 'bg-gray-700'
                            }`}
                            style={{ 
                                height: `${height * 100}%`,
                                opacity: isPlaying ? 1 : 0.7
                            }}
                        />
                    ))}
                 </div>

                 {/* Timeline */}
                 <div className="space-y-2 flex-none">
                     <div 
                        ref={progressBarRef}
                        className="h-3 md:h-2 bg-gray-700 rounded-full cursor-pointer relative overflow-hidden group touch-none"
                        onClick={handleProgressClick}
                     >
                         <div 
                            className="absolute top-0 left-0 h-full bg-indigo-500 transition-all duration-100 ease-linear"
                            style={{ width: `${progressPercent}%` }}
                         />
                         <div 
                            className="absolute top-0 h-full w-4 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 -translate-x-1/2 transition-opacity hidden md:block"
                            style={{ left: `${progressPercent}%` }}
                         />
                     </div>
                     <div className="flex justify-between text-xs text-gray-400 font-mono">
                         <span>{formatTime(currentTime)}</span>
                         <span>{formatTime(duration)}</span>
                     </div>
                 </div>
             </div>
         )}
      </div>

      {/* Controls Footer */}
      <div className="flex-none bg-gray-900 border-t border-gray-800 p-3 md:px-8 md:h-24 flex flex-row items-center gap-4 md:gap-8 justify-between">
        
        {/* Playback Button */}
        <div className="flex-none">
             <button 
                className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-white text-gray-900 hover:bg-indigo-50 hover:text-indigo-600 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg md:shadow-none"
                onClick={onPlayPause}
                disabled={!audioBuffer}
             >
                 {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
             </button>
        </div>

        {/* Volume Channel (Expanded on mobile for ease of use) */}
        <div className="flex-1 flex items-center justify-end md:justify-center gap-3 md:gap-4 md:border-l md:border-gray-800 md:pl-8">
            <div className="flex items-center gap-2 w-full max-w-[200px] md:w-64">
                <Volume2 size={18} className="text-indigo-400 shrink-0" />
                <input 
                    type="range" 
                    min="0" 
                    max="1" 
                    step="0.01" 
                    value={speechVolume}
                    onChange={(e) => setSpeechVolume(parseFloat(e.target.value))}
                    className="flex-1 h-2 md:h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:bg-transparent"
                />
            </div>
            <div className="text-xs text-gray-500 font-mono w-8 text-right hidden md:block">
                {Math.round(speechVolume * 100)}%
            </div>
        </div>

      </div>
    </div>
  );
};