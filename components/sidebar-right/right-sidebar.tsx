'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import TriggersTab from './triggers-tab'

const DEFAULT_WIDTH = 570
const MIN_WIDTH = 280
const MAX_WIDTH = 900

interface RightSidebarProps {
  instanceName: string | null
  isOpen: boolean
}

type ActiveTab = 'gatilhos' | 'fluxos'

export default function RightSidebar({ instanceName, isOpen }: RightSidebarProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('gatilhos')
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return
    const delta = startX.current - e.clientX
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta))
    setWidth(next)
  }, [])

  const onMouseUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }, [onMouseMove])

  const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = width
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [width, onMouseMove, onMouseUp])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [onMouseMove, onMouseUp])

  return (
    <div
      className="relative flex flex-col h-full border-l border-[#d1d7db] bg-white shrink-0 overflow-hidden"
      style={{ width: isOpen ? width : 0, transition: dragging.current ? 'none' : 'width 200ms' }}
    >
      {/* Drag handle */}
      {isOpen && (
        <div
          onMouseDown={onHandleMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize z-10 hover:bg-[#00a884]/30 active:bg-[#00a884]/50 transition-colors"
          title="Arrastar para redimensionar"
        />
      )}

      {isOpen && (
        <>
          {/* Tab bar */}
          <div className="flex items-center border-b border-[#d1d7db] shrink-0 px-1">
            {(['gatilhos', 'fluxos'] as ActiveTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={[
                  'flex-1 py-3 text-sm font-medium capitalize transition-colors',
                  activeTab === tab
                    ? 'text-[#00a884] border-b-2 border-[#00a884]'
                    : 'text-[#667781] hover:text-[#111b21]',
                ].join(' ')}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0">
            {activeTab === 'gatilhos' ? (
              instanceName ? (
                <TriggersTab instanceName={instanceName} />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-xs text-[#aebac1]">Nenhuma conta ativa.</p>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
                <p className="text-sm font-medium text-[#111b21]">Fluxos</p>
                <p className="text-xs text-[#aebac1]">
                  O construtor visual de fluxos estará disponível em breve.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
