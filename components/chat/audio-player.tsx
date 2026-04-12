'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { Pause, Play, Mic } from 'lucide-react'

interface AudioPlayerProps {
  src: string
  isOutbound: boolean
  avatarUrl?: string | null
  initials?: string
}

const BAR_COUNT = 30

function generateBars(): number[] {
  // Deterministic-looking waveform — seeded by index so it's stable across renders
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const base = Math.sin(i * 0.8) * 0.3 + Math.sin(i * 1.7) * 0.25 + Math.sin(i * 3.1) * 0.15
    return Math.max(0.15, Math.min(1, 0.5 + base))
  })
}

function formatTime(seconds: number): string {
  const s = Math.floor(seconds)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export default function AudioPlayer({ src, isOutbound, avatarUrl, initials }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [imgError, setImgError] = useState(false)
  const bars = useMemo(() => generateBars(), [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onDurationChange = () => setDuration(audio.duration || 0)
    const onEnded = () => { setPlaying(false); setCurrentTime(0) }
    const onLoadedMetadata = () => setDuration(audio.duration || 0)

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('ended', onEnded)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('ended', onEnded)
    }
  }, [])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      audio.play().then(() => setPlaying(true)).catch(() => {})
    }
  }

  const handleBarClick = (index: number) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    audio.currentTime = (index / BAR_COUNT) * duration
  }

  const progress = duration > 0 ? currentTime / duration : 0
  const filledBars = Math.floor(progress * BAR_COUNT)
  const timeDisplay = playing || currentTime > 0 ? formatTime(currentTime) : formatTime(duration)

  // Colors
  const playedColor = isOutbound ? '#4fc3f7' : '#53bdeb'
  const unplayedColor = isOutbound ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.18)'
  const playBtnBg = isOutbound ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.08)'

  return (
    <div className="flex items-center gap-2" style={{ minWidth: 220, maxWidth: 300 }}>
      {/* Avatar / mic icon */}
      <div
        className="shrink-0 rounded-full overflow-hidden flex items-center justify-center"
        style={{
          width: 36,
          height: 36,
          background: isOutbound ? 'rgba(0,0,0,0.15)' : '#dfe5e7',
          color: isOutbound ? 'rgba(255,255,255,0.8)' : '#667781',
        }}
      >
        {!isOutbound && avatarUrl && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : !isOutbound && initials ? (
          <span className="text-xs font-semibold">{initials}</span>
        ) : (
          <Mic size={16} />
        )}
      </div>

      {/* Play / pause */}
      <button
        type="button"
        onClick={togglePlay}
        className="shrink-0 rounded-full flex items-center justify-center transition-opacity hover:opacity-80 active:opacity-60"
        style={{
          width: 34,
          height: 34,
          background: playBtnBg,
          color: isOutbound ? '#111b21' : '#111b21',
        }}
        aria-label={playing ? 'Pausar' : 'Reproduzir'}
      >
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="translate-x-px" />}
      </button>

      {/* Waveform + time */}
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="flex items-end gap-[2px] h-8 cursor-pointer" onClick={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const ratio = (e.clientX - rect.left) / rect.width
          const audio = audioRef.current
          if (audio && duration) audio.currentTime = ratio * duration
        }}>
          {bars.map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-full transition-colors duration-75"
              style={{
                height: `${Math.round(h * 100)}%`,
                minHeight: 3,
                background: i <= filledBars ? playedColor : unplayedColor,
              }}
              onClick={(e) => { e.stopPropagation(); handleBarClick(i) }}
            />
          ))}
        </div>
        <span
          className="text-[10px] leading-none tabular-nums"
          style={{ color: isOutbound ? 'rgba(0,0,0,0.45)' : '#667781' }}
        >
          {timeDisplay || '0:00'}
        </span>
      </div>

      <audio ref={audioRef} src={src} preload="metadata" />
    </div>
  )
}
