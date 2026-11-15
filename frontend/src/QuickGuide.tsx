import {useEffect, useId, useRef, useState} from 'react'
import {Activity, ArrowLeft, Box, CircleHelp, Moon, Orbit, Sparkles, Waves, X} from 'lucide-react'
import './quickGuide.css'

const topics = [
  [Orbit, 'Explore the Orbit', 'Drag or scroll to rotate the orbital system and explore the available modules.'],
  [Moon, 'Select a Module', 'Click an illuminated orbital moon to open its corresponding section.'],
  [ArrowLeft, 'Return to Orbit', 'Use “Return to Orbit” to navigate back to the central star.'],
  [Sparkles, 'AI Companion', 'Select “Start assistant” to interact with AEGIS using voice or text.'],
  [Activity, 'Health Monitoring', 'Explore vital signs, sleep patterns, psychological wellness and crew health.'],
  [Waves, 'Relax Room', 'Access breathing exercises, relaxing sounds and interactive activities.'],
  [Box, '3D BioSystems', 'Explore the interactive anatomical simulation using its available controls.'],
] as const

export function QuickGuide() {
  const id = useId()
  const [open, setOpen] = useState(false)
  const dock = useRef<HTMLDivElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const dismiss = useRef<HTMLButtonElement>(null)
  const topicList = useRef<HTMLUListElement>(null)
  const previousScroll = useRef(0)

  function close() {
    setOpen(false)
    launcher.current?.focus({preventScroll: true})
    window.scrollTo({top: previousScroll.current, behavior: 'instant'})
  }

  useEffect(() => {
    if (!open) return
    dock.current?.scrollIntoView?.({block: 'end', behavior: 'instant'})
    if (topicList.current) topicList.current.scrollTop = 0
    dismiss.current?.focus({preventScroll: true})
    function onEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      close()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [open])

  return <div className="quick-guide" ref={dock} data-open={open}>
    <button type="button" ref={launcher} className="quick-guide-toggle" aria-expanded={open} aria-controls={id}
      onClick={() => {
        if (open) close()
        else {
          previousScroll.current = window.scrollY
          setOpen(true)
        }
      }}><CircleHelp size={17} aria-hidden="true"/> Quick Guide</button>
    <section className="quick-guide-panel" id={id} aria-labelledby={`${id}-title`} inert={!open}>
      <header>
        <div><h2 id={`${id}-title`}>Welcome to AEGIS BioSystems</h2><p>Your guide to the mission experience.</p></div>
        <button type="button" ref={dismiss} aria-label="Close Quick Guide" onClick={close}><X size={18} aria-hidden="true"/></button>
      </header>
      <ul ref={topicList} tabIndex={0} aria-label="Guide topics">
        {topics.map(([Icon, title, instruction]) => <li key={title}>
          <Icon size={15} aria-hidden="true"/><div><h3>{title}</h3><p>{instruction}</p></div>
        </li>)}
      </ul>
    </section>
  </div>
}
