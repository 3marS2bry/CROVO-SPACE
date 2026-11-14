import React, { useState, useEffect, useRef } from 'react';
import { X, Play, Pause, Square, BookOpen, Volume2, Sparkles } from 'lucide-react';
import { sounds } from '../utils/soundEffects';

interface QuranPlayerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SurahItem {
  name: string;
  reciter: string;
  url: string;
}

export const QuranPlayer: React.FC<QuranPlayerProps> = ({ isOpen, onClose }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSurahIdx, setCurrentSurahIdx] = useState(0);
  const [surahsList, setSurahsList] = useState<SurahItem[]>([]);

  useEffect(() => {
    const MN = 'https://cdn.mp3quran.net/audio/muhammad-minshawi/r2/';
    const DS = 'https://cdn.mp3quran.net/audio/yasser-dosari/r1/';

    const d = new Date();
    // Friday: Surat Al-Kahf
    if (d.getDay() === 5) {
      setSurahsList([
        { name: 'سورة الكهف', reciter: 'محمد صديق المنشاوي', url: MN + '018.mp3' },
        { name: 'سورة الكهف', reciter: 'ياسر الدوسري', url: DS + '018.mp3' },
      ]);
    } else {
      // Daily rotation
      setSurahsList([
        { name: 'سورة مريم', reciter: 'محمد صديق المنشاوي', url: MN + '019.mp3' },
        { name: 'سورة يس', reciter: 'محمد صديق المنشاوي', url: MN + '036.mp3' },
        { name: 'سورة الرحمن', reciter: 'محمد صديق المنشاوي', url: MN + '055.mp3' },
        { name: 'سورة الملك', reciter: 'ياسر الدوسري', url: DS + '067.mp3' },
        { name: 'سورة النور', reciter: 'محمد صديق المنشاوي', url: MN + '024.mp3' },
      ]);
    }
  }, []);

  const handlePlay = (idx: number) => {
    sounds.playClick();
    if (currentSurahIdx === idx && isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      setCurrentSurahIdx(idx);
      if (audioRef.current) {
        audioRef.current.src = surahsList[idx].url;
        audioRef.current
          .play()
          .then(() => setIsPlaying(true))
          .catch(() => {});
      }
    }
  };

  const handleStop = () => {
    sounds.playClick();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="clay-card w-full max-w-md p-6 relative text-right animate-in zoom-in-95 duration-200"
      >
        <button
          onClick={() => {
            sounds.playClick();
            onClose();
          }}
          className="absolute top-4 left-4 p-2 rounded-xl clay-btn text-slate-400 hover:text-slate-700"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="w-4 h-4 text-emerald-500" />
          <h3 className="text-base font-black text-slate-900">
            القرآن الكريم للتركيز والراحة 📖
          </h3>
        </div>
        <p className="text-xs text-slate-500 mb-5 leading-relaxed">
          تلاوات عذبة هادئة في الخلفية لتريح ذهنك وتساعدك على التركيز أثناء حل المسائل والمذاكرة.
        </p>

        {/* Hidden Audio Element */}
        <audio
          ref={audioRef}
          onEnded={() => {
            const nextIdx = (currentSurahIdx + 1) % surahsList.length;
            handlePlay(nextIdx);
          }}
        />

        {/* Surahs List */}
        <div className="flex flex-col gap-2 mb-5">
          {surahsList.map((item, idx) => {
            const isCurrent = currentSurahIdx === idx && isPlaying;
            return (
              <div
                key={idx}
                onClick={() => handlePlay(idx)}
                className={`p-3 rounded-xl clay-btn flex items-center justify-between cursor-pointer transition-all ${
                  isCurrent ? 'bg-indigo-50 border border-indigo-300' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs ${
                      isCurrent ? 'bg-indigo-600 text-white' : 'clay-inset text-slate-600'
                    }`}
                  >
                    {isCurrent ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      {item.name}
                    </div>
                    <div className="text-[11px] text-slate-500">{item.reciter}</div>
                  </div>
                </div>

                {isCurrent && (
                  <span className="text-[10px] font-bold text-emerald-500 animate-pulse">
                    جاري التشغيل...
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Stop button */}
        {isPlaying && (
          <button
            onClick={handleStop}
            className="w-full clay-btn py-2 rounded-xl text-xs font-bold text-rose-500 flex items-center justify-center gap-1.5"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>إيقاف التلاوة</span>
          </button>
        )}
      </div>
    </div>
  );
};
