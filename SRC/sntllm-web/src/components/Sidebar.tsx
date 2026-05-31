import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'
import type { Project, Note, NoteType } from '../types'

// ── helpers ──────────────────────────────────────────────────────────────────

type NoteWithChildren = Note & { children: NoteWithChildren[] }

function buildTree(notes: Note[]): NoteWithChildren[] {
  const map = new Map<string, NoteWithChildren>()
  notes.forEach(n => map.set(n.id, { ...n, children: [] }))
  const roots: NoteWithChildren[] = []
  map.forEach(n => {
    if (n.parentNoteId && map.has(n.parentNoteId)) {
      map.get(n.parentNoteId)!.children.push(n)
    } else {
      roots.push(n)
    }
  })
  return roots
}

const MONTH_NAMES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
]

// isCalendarContainer: nota com título no formato "DD/MM/YYYY" e sem pai
function isCalendarContainer(n: Note): boolean {
  return n.parentNoteId == null && /^\d{2}\/\d{2}\/\d{4}$/.test(n.title ?? '')
}

interface CalDay   { dateKey: string; label: string; container: Note | null; children: Note[] }
interface CalMonth { key: string; label: string; days: CalDay[] }
interface CalYear  { year: string; months: CalMonth[] }

function buildCalendar(notes: Note[]): CalYear[] {
  // Separar containers de dia das notas-filhas
  const containers = notes.filter(n => isCalendarContainer(n))
  const childrenById = new Map<string, Note[]>()
  for (const n of notes) {
    if (n.parentNoteId && !isCalendarContainer(n)) {
      const arr = childrenById.get(n.parentNoteId) ?? []
      arr.push(n)
      childrenById.set(n.parentNoteId, arr)
    }
  }

  // Notas-filhas que ficaram órfãs (sem container correspondente) — compatibilidade com dados antigos
  const containerIds = new Set(containers.map(c => c.id))
  const orphans = notes.filter(n =>
    !isCalendarContainer(n) &&
    n.noteDate &&
    (!n.parentNoteId || !containerIds.has(n.parentNoteId))
  )

  // Agrupar por ano/mês/dia
  const map = new Map<string, Map<string, Map<string, { container: Note | null; children: Note[] }>>>()

  const addDay = (dk: string, y: string, mk: string, container: Note | null, children: Note[]) => {
    if (!map.has(y)) map.set(y, new Map())
    const months = map.get(y)!
    if (!months.has(mk)) months.set(mk, new Map())
    const days = months.get(mk)!
    if (!days.has(dk)) days.set(dk, { container: null, children: [] })
    const entry = days.get(dk)!
    if (container) entry.container = container
    entry.children.push(...children)
  }

  for (const c of containers) {
    if (!c.noteDate) continue
    const d = new Date(c.noteDate)
    const y = d.getFullYear().toString()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    addDay(`${y}-${m}-${day}`, y, `${y}-${m}`, c, childrenById.get(c.id) ?? [])
  }

  for (const n of orphans) {
    if (!n.noteDate) continue
    const d = new Date(n.noteDate)
    const y = d.getFullYear().toString()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    addDay(`${y}-${m}-${day}`, y, `${y}-${m}`, null, [n])
  }

  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, months]) => ({
      year,
      months: [...months.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([mk, days]) => ({
          key: mk,
          label: MONTH_NAMES[parseInt(mk.split('-')[1]) - 1],
          days: [...days.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([dk, { container, children }]) => {
              const p = dk.split('-')
              return { dateKey: dk, label: `${p[2]}/${p[1]}/${p[0]}`, container, children }
            }),
        })),
    }))
}

// ── expand-state ─────────────────────────────────────────────────────────────

interface ProjState {
  open: boolean
  sections: Record<'free' | 'cal' | 'docs' | 'chat', boolean>
  years: Record<string, boolean>
  months: Record<string, boolean>
  days: Record<string, boolean>
  noteOpen: Record<string, boolean>
}

function defaultProjState(): ProjState {
  return { open: false, sections: { free: true, cal: false, docs: false, chat: false }, years: {}, months: {}, days: {}, noteOpen: {} }
}

// ── sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ icon, label, count, open, onClick }: {
  icon: string; label: string; count: number; open: boolean; onClick: () => void
}) {
  return (
    <div style={s.sectionRow} onClick={onClick}>
      <span style={s.chevron}>{open ? '▾' : '▸'}</span>
      <span style={s.icon}>{icon}</span>
      <span style={s.sectionLabel}>{label}</span>
      <span style={s.badge}>{count}</span>
    </div>
  )
}

function NoteRow({ note, indent, noteOpen, onToggle }: {
  note: NoteWithChildren
  indent: number
  noteOpen: Record<string, boolean>
  onToggle: (id: string) => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const isActive = location.pathname === `/notes/${note.id}`
  const open = !!noteOpen[note.id]
  return (
    <div>
      <div
        style={{ ...s.row, paddingLeft: indent, background: isActive ? '#312e81' : undefined }}
        onClick={() => navigate(`/notes/${note.id}`)}
      >
        {note.children.length > 0
          ? <span style={s.chevron} onClick={e => { e.stopPropagation(); onToggle(note.id) }}>{open ? '▾' : '▸'}</span>
          : <span style={s.gap} />}
        <span style={s.icon}>📄</span>
        <span style={{ ...s.label, color: isActive ? '#fff' : '#cbd5e1' }}>
          {note.title || 'Sem título'}
        </span>
      </div>
      {open && note.children.map(c => (
        <NoteRow key={c.id} note={c} indent={indent + 12} noteOpen={noteOpen} onToggle={onToggle} />
      ))}
    </div>
  )
}

function CalNoteRow({ note }: { note: Note }) {
  const navigate = useNavigate()
  const location = useLocation()
  const isActive = location.pathname === `/notes/${note.id}`
  return (
    <div
      style={{ ...s.row, paddingLeft: 72, background: isActive ? '#312e81' : undefined }}
      onClick={() => navigate(`/notes/${note.id}`)}
    >
      <span style={s.gap} />
      <span style={s.icon}>📄</span>
      <span style={{ ...s.label, fontSize: 12, color: isActive ? '#fff' : '#cbd5e1' }}>
        {note.title || 'Sem título'}
      </span>
    </div>
  )
}

function CalDayRow({ day, isOpen, onToggle }: {
  day: { dateKey: string; label: string; container: Note | null; children: Note[] }
  isOpen: boolean
  onToggle: () => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const isActive = day.container ? location.pathname === `/notes/${day.container.id}` : false
  const hasChildren = day.children.length > 0

  return (
    <div>
      {/* L4: Dia — clicável se tiver nota-container */}
      <div
        style={{ ...s.row, paddingLeft: 60, background: isActive ? '#312e81' : undefined, cursor: 'pointer' }}
        onClick={() => {
          if (hasChildren) onToggle()
          if (day.container) navigate(`/notes/${day.container.id}`)
        }}
      >
        {hasChildren
          ? <span style={s.chevron} onClick={e => { e.stopPropagation(); onToggle() }}>{isOpen ? '▾' : '▸'}</span>
          : <span style={s.gap} />}
        <span style={s.icon}>📅</span>
        <span style={{ ...s.label, fontSize: 12, color: isActive ? '#fff' : '#94a3b8', fontWeight: 500 }}>
          {day.label}
        </span>
        {day.children.length > 0 && (
          <span style={{ ...s.badge, marginLeft: 4 }}>{day.children.length}</span>
        )}
      </div>
      {/* L5: filhos */}
      {isOpen && day.children.map(n => <CalNoteRow key={n.id} note={n} />)}
    </div>
  )
}

function ChatRow({ note }: { note: Note }) {
  const navigate = useNavigate()
  const location = useLocation()
  const isActive = location.pathname === `/chat/${note.id}`
  return (
    <div
      style={{ ...s.row, paddingLeft: 36, background: isActive ? '#312e81' : undefined }}
      onClick={() => navigate(`/chat/${note.id}`)}
    >
      <span style={s.gap} />
      <span style={s.icon}>💬</span>
      <span style={{ ...s.label, color: isActive ? '#fff' : '#cbd5e1' }}>
        {note.title || 'Chat sem título'}
      </span>
    </div>
  )
}

// ── MiniCalendar ──────────────────────────────────────────────────────────────

function MiniCalendar({ notes }: { notes: Note[] }) {
  const navigate = useNavigate()
  const today = new Date()
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() })

  // Build per-day counts (children only, not containers) and container map
  const dateCounts    = new Map<string, number>()
  const dateContainer = new Map<string, Note>()

  for (const n of notes) {
    if (n.noteType !== 1 || !n.noteDate) continue
    const d  = new Date(n.noteDate)
    const dk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    if (isCalendarContainer(n)) {
      dateContainer.set(dk, n)
    } else {
      dateCounts.set(dk, (dateCounts.get(dk) ?? 0) + 1)
    }
  }

  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const startDow    = new Date(view.year, view.month, 1).getDay()
  const todayDk     = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

  const cells: (number | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  function toDk(day: number) {
    return `${view.year}-${String(view.month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
  }

  function handleDayClick(day: number) {
    const dk  = toDk(day)
    const cnt = dateContainer.get(dk)
    if (cnt) {
      navigate(`/notes/${cnt.id}`)
    } else {
      navigate('/notes/new', { state: { noteType: 1, date: dk } })
    }
  }

  function dot(count: number): { char: string; color: string } | null {
    if (count >= 10) return { char: '⁜', color: '#f87171' }
    if (count >= 4)  return { char: '⁙', color: '#fbbf24' }
    if (count >= 1)  return { char: '⁘', color: '#4ade80' }
    return null
  }

  const prevMonth = () => setView(v => ({
    year:  v.month === 0 ? v.year - 1 : v.year,
    month: v.month === 0 ? 11 : v.month - 1,
  }))
  const nextMonth = () => setView(v => ({
    year:  v.month === 11 ? v.year + 1 : v.year,
    month: v.month === 11 ? 0 : v.month + 1,
  }))

  const DOW = ['D','S','T','Q','Q','S','S']

  return (
    <div style={s.miniCal}>
      <div style={s.calHeader}>
        <button style={s.calNavBtn} onClick={prevMonth}>‹</button>
        <span style={s.calTitle}>{MONTH_NAMES[view.month]} {view.year}</span>
        <button style={s.calNavBtn} onClick={nextMonth}>›</button>
      </div>

      <div style={s.calGrid}>
        {DOW.map((d, i) => (
          <div key={i} style={s.calDow}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} style={s.calCell} />
          const dk    = toDk(day)
          const count = dateCounts.get(dk) ?? 0
          const d     = dot(count)
          const isToday = dk === todayDk
          return (
            <div
              key={i}
              style={{
                ...s.calCell,
                background: isToday ? '#4f46e5' : undefined,
                borderRadius: isToday ? 4 : undefined,
                cursor: 'pointer',
              }}
              onClick={() => handleDayClick(day)}
            >
              <span style={{ ...s.calDayNum, color: isToday ? '#fff' : '#cbd5e1' }}>{day}</span>
              {d && <span style={{ fontSize: 7, color: d.color, lineHeight: 1 }}>{d.char}</span>}
            </div>
          )
        })}
      </div>

      <div style={s.calLegend}>
        <span style={{ color: '#4ade80' }}>⁘</span> 1-3 &nbsp;
        <span style={{ color: '#fbbf24' }}>⁙</span> 4-9 &nbsp;
        <span style={{ color: '#f87171' }}>⁜</span> 10+
      </div>
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function Sidebar() {
  const { user: authUser, logout: doLogout } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [states, setStates] = useState<Record<string, ProjState>>({})

  const refresh = useCallback(() => {
    api.get<Project[]>('/projects').then(r => setProjects(r.data)).catch(() => {})
    api.get<Note[]>('/notes').then(r => setNotes(r.data)).catch(() => {})
  }, [])

  useEffect(() => { refresh() }, [refresh])

  function upd(pid: string, fn: (cur: ProjState) => ProjState) {
    setStates(prev => ({ ...prev, [pid]: fn(prev[pid] ?? defaultProjState()) }))
  }
  const toggleProject = (pid: string) => upd(pid, c => ({ ...c, open: !c.open }))
  const toggleSection = (pid: string, sec: 'free' | 'cal' | 'docs' | 'chat') =>
    upd(pid, c => ({ ...c, sections: { ...c.sections, [sec]: !c.sections[sec] } }))
  const toggleYear = (pid: string, y: string) =>
    upd(pid, c => ({ ...c, years: { ...c.years, [y]: !c.years[y] } }))
  const toggleMonth = (pid: string, mk: string) =>
    upd(pid, c => ({ ...c, months: { ...c.months, [mk]: !c.months[mk] } }))
  const toggleDay = (pid: string, dk: string) =>
    upd(pid, c => ({ ...c, days: { ...c.days, [dk]: !c.days[dk] } }))
  const toggleNote = (pid: string, nid: string) =>
    upd(pid, c => ({ ...c, noteOpen: { ...c.noteOpen, [nid]: !c.noteOpen[nid] } }))

  const byType = (pid: string, type: NoteType) =>
    notes.filter(n => n.projectId === pid && n.noteType === type)

  return (
    <aside style={s.sidebar}>
      {/* Logo */}
      <div style={s.logoRow}>
        <span style={s.logo}>📓 SNT</span>
        <button style={s.iconBtn} onClick={refresh} title="Atualizar">↺</button>
      </div>

      {/* Tree */}
      <div style={s.tree}>
        {projects.length === 0 && (
          <div style={s.empty}>
            Nenhum projeto ainda.
            <button style={s.newProjBtn} onClick={() => navigate('/projects/new')}>+ Criar projeto</button>
          </div>
        )}

        {projects.map(proj => {
          const st = states[proj.id] ?? defaultProjState()
          const free = byType(proj.id, 0)
          const cal  = byType(proj.id, 1)
          const docs = byType(proj.id, 2)
          const chats = byType(proj.id, 3)

          return (
            <div key={proj.id}>
              {/* L0: Projeto */}
              <div style={s.projRow} onClick={() => toggleProject(proj.id)}>
                <span style={s.chevron}>{st.open ? '▾' : '▸'}</span>
                <span style={s.icon}>🗂️</span>
                <span style={s.projLabel}>{proj.name}</span>
                <button
                  style={s.addBtn}
                  title="Nova nota neste projeto"
                  onClick={e => {
                    e.stopPropagation()
                    navigate('/notes/new', { state: { projectId: proj.id } })
                  }}
                >+</button>
              </div>

              {st.open && (
                <div>
                  {/* L1: Notas Livres */}
                  <SectionHeader
                    icon="📝" label="Notas Livres" count={free.length}
                    open={st.sections.free} onClick={() => toggleSection(proj.id, 'free')}
                  />
                  {st.sections.free && (
                    free.length === 0
                      ? <div style={{ ...s.hint, paddingLeft: 36 }}>Nenhuma nota livre</div>
                      : buildTree(free).map(n => (
                          <NoteRow key={n.id} note={n} indent={36}
                            noteOpen={st.noteOpen} onToggle={nid => toggleNote(proj.id, nid)} />
                        ))
                  )}

                  {/* L1: Notas de Calendário */}
                  <SectionHeader
                    icon="📅" label="Notas de Calendário" count={cal.length}
                    open={st.sections.cal} onClick={() => toggleSection(proj.id, 'cal')}
                  />
                  {st.sections.cal && (
                    cal.length === 0
                      ? <div style={{ ...s.hint, paddingLeft: 36 }}>Nenhuma nota de calendário</div>
                      : buildCalendar(cal).map(yr => (
                          <div key={yr.year}>
                            {/* L2: Ano */}
                            <div style={{ ...s.row, paddingLeft: 36 }} onClick={() => toggleYear(proj.id, yr.year)}>
                              <span style={s.chevron}>{st.years[yr.year] ? '▾' : '▸'}</span>
                              <span style={s.icon}>📁</span>
                              <span style={s.label}>{yr.year}</span>
                            </div>
                            {st.years[yr.year] && yr.months.map(mo => (
                              <div key={mo.key}>
                                {/* L3: Mês */}
                                <div style={{ ...s.row, paddingLeft: 48 }} onClick={() => toggleMonth(proj.id, mo.key)}>
                                  <span style={s.chevron}>{st.months[mo.key] ? '▾' : '▸'}</span>
                                  <span style={s.icon}>📁</span>
                                  <span style={s.label}>{mo.label}</span>
                                </div>
                                {st.months[mo.key] && mo.days.map(day => (
                                  <CalDayRow
                                    key={day.dateKey}
                                    day={day}
                                    isOpen={!!st.days[day.dateKey]}
                                    onToggle={() => toggleDay(proj.id, day.dateKey)}
                                  />
                                ))}
                              </div>
                            ))}
                          </div>
                        ))
                  )}

                  {/* L1: Documentos */}
                  <SectionHeader
                    icon="📄" label="Documentos" count={docs.length}
                    open={st.sections.docs} onClick={() => toggleSection(proj.id, 'docs')}
                  />
                  {st.sections.docs && (
                    docs.length === 0
                      ? <div style={{ ...s.hint, paddingLeft: 36 }}>Nenhum documento</div>
                      : buildTree(docs).map(n => (
                          <NoteRow key={n.id} note={n} indent={36}
                            noteOpen={st.noteOpen} onToggle={nid => toggleNote(proj.id, nid)} />
                        ))
                  )}

                  {/* L1: Chats */}
                  <SectionHeader
                    icon="💬" label="Chats" count={chats.length}
                    open={st.sections.chat} onClick={() => toggleSection(proj.id, 'chat')}
                  />
                  {st.sections.chat && (
                    chats.length === 0
                      ? <div style={{ ...s.hint, paddingLeft: 36 }}>Nenhum chat</div>
                      : chats.map(n => (
                          <ChatRow key={n.id} note={n} />
                        ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Mini Calendar */}
      <MiniCalendar notes={notes} />

      {/* Bottom */}
      <div style={s.bottom}>
        <button style={s.navBtn} onClick={() => navigate('/')}>🏠 Dashboard</button>
        <button style={s.navBtn} onClick={() => navigate('/projects/new')}>🗂️ Projetos</button>
        <button style={s.navBtn} onClick={() => navigate('/chat/new')}>💬 Novo Chat</button>
        {authUser?.role === 'Admin' && (
          <button style={s.navBtn} onClick={() => navigate('/settings')}>⚙️ Configurações</button>
        )}
        <div style={s.userRow}>
          <span style={s.userName}>{authUser?.userName}</span>
          <button style={s.logoutBtn} onClick={doLogout}>Sair</button>
        </div>
      </div>
    </aside>
  )
}

// ── styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 268, minWidth: 268,
    background: '#1e293b',
    display: 'flex', flexDirection: 'column',
    height: '100vh', overflow: 'hidden',
    borderRight: '1px solid #334155',
    userSelect: 'none',
  },
  logoRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0.9rem 1rem 0.75rem',
    borderBottom: '1px solid #334155',
    flexShrink: 0,
  },
  logo: { color: '#6366f1', fontSize: 17, fontWeight: 800 },
  iconBtn: { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16 },
  tree: { flex: 1, overflowY: 'auto', padding: '4px 0' },

  projRow: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '0.45rem 0.5rem 0.45rem 8px',
    cursor: 'pointer', borderRadius: 6, margin: '2px 4px',
    background: '#0f172a',
  },
  projLabel: {
    flex: 1, fontSize: 13, fontWeight: 700, color: '#e2e8f0',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  addBtn: {
    background: 'none', border: 'none', color: '#6366f1',
    cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px',
  },

  sectionRow: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '0.3rem 0.5rem 0.3rem 16px',
    cursor: 'pointer', borderRadius: 6, margin: '1px 4px',
  },
  sectionLabel: {
    flex: 1, fontSize: 11, fontWeight: 600, color: '#94a3b8',
    textTransform: 'uppercase', letterSpacing: '0.04em',
  },
  badge: {
    fontSize: 11, color: '#475569',
    background: '#0f172a', borderRadius: 10, padding: '1px 6px',
  },

  row: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '0.28rem 0.5rem',
    cursor: 'pointer', borderRadius: 6, margin: '1px 4px',
  },
  chevron: { fontSize: 10, color: '#475569', width: 12, flexShrink: 0 },
  gap:     { width: 12, flexShrink: 0 },
  icon:    { fontSize: 12, flexShrink: 0 },
  label: {
    flex: 1, fontSize: 13, color: '#94a3b8',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },

  hint: { fontSize: 11, color: '#475569', padding: '0.25rem 0.5rem', fontStyle: 'italic' },
  empty: { fontSize: 12, color: '#475569', padding: '0.75rem', textAlign: 'center' },
  newProjBtn: {
    display: 'block', margin: '6px auto 0',
    background: 'none', border: '1px solid #334155', color: '#6366f1',
    borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12,
  },

  bottom: { borderTop: '1px solid #334155', padding: '0.6rem 0.5rem', flexShrink: 0 },
  navBtn: {
    display: 'block', width: '100%', background: 'none', border: 'none',
    color: '#94a3b8', textAlign: 'left', padding: '0.45rem 0.75rem',
    borderRadius: 8, cursor: 'pointer', fontSize: 13, marginBottom: 2,
  },
  userRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0.45rem 0.75rem', marginTop: 4,
  },
  userName: { fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis' },
  logoutBtn: { background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 12 },

  // MiniCalendar
  miniCal: {
    borderTop: '1px solid #334155',
    padding: '0.5rem 0.5rem 0.35rem',
    flexShrink: 0,
  },
  calHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 4,
  },
  calTitle: { fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.02em' },
  calNavBtn: {
    background: 'none', border: 'none', color: '#6366f1',
    cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 4px',
  },
  calGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1,
  },
  calDow: {
    fontSize: 9, color: '#475569', textAlign: 'center' as const,
    fontWeight: 700, padding: '2px 0',
  },
  calCell: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
    padding: '2px 1px', minHeight: 22, borderRadius: 3,
  },
  calDayNum: { fontSize: 10, lineHeight: '1.3' },
  calLegend: {
    fontSize: 9, color: '#475569', textAlign: 'center' as const,
    marginTop: 5, letterSpacing: '0.03em',
  },
}
