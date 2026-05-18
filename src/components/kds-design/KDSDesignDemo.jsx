import { useState } from 'react'
import { ChefHat, Beer, Zap, Eye, Plus } from 'lucide-react'
import KDSLayout from './KDSLayout.jsx'
import NoteModal, { DEFAULT_NOTES } from './NoteModal.jsx'

/**
 * KDSDesignDemo — canvas interattivo per validare il nuovo design KDS.
 *
 * Montabile a livello App.jsx come pagina temporanea ("/design" o simile),
 * oppure renderizzabile in standalone in un sandbox React/Vite.
 *
 * Cosa si puo' fare qui dentro:
 *   - vedere le 3 colonne con i mock data della spec
 *   - cliccare i pulsanti principali → card "vola" nella colonna successiva
 *   - cliccare RUSH → la card sale in cima alla colonna DA FARE con bordo lampeggiante
 *   - vedere il timer contare (setInterval interno alle card)
 *   - switchare ruolo CUCINA / BAR (cambia il gradiente header)
 *   - aprire il NoteModal e selezionare note cottura
 */
export default function KDSDesignDemo() {
  const [role, setRole] = useState('cucina')
  const [noteOpen, setNoteOpen] = useState(false)
  const [appliedNotes, setAppliedNotes] = useState([])

  // Stress test e reset (uncontrolled mode: bump della key forza remount)
  const [extraOrders, setExtraOrders] = useState([])
  const [resetKey, setResetKey] = useState(0)

  const addStressBatch = () => {
    const seed = Date.now()
    const piattiPool = role === 'cucina'
      ? ['Vincisgrassi al ragù','Tagliatelle al cinghiale','Passatelli in brodo',
         'Olive ascolane','Coniglio in porchetta','Scottadito di agnello',
         'Bruschette al pomodoro','Crescia sfogliata']
      : ["Verdicchio Castelli di Jesi","Lacrima di Morro d'Alba",'Acqua naturale 1L',
         'Acqua frizzante 1L','Caffè','Mistrà','Vino sfuso rosso 1L','Birra Forst 0.4L']
    const clientiPool = ['Anna','Marco','Sara','Luca','Elena','Paolo','Chiara','Giulia','Bruno','Maria']
    const stati = ['sbloccata','sbloccata','sbloccata','sbloccata','sbloccata','pre_riscaldo','sbloccata','sbloccata','sbloccata','sbloccata']
    const nuovi = Array.from({ length: 10 }, (_, i) => {
      const items = []
      const nItems = 1 + (i % 4)   // 1..4 piatti
      for (let k = 0; k < nItems; k++) {
        items.push({
          nome: piattiPool[(i + k) % piattiPool.length],
          q: 1 + ((i + k) % 4),
        })
      }
      return {
        id: `stress-${seed}-${i}`,
        tavolo: 50 + i,
        cliente: clientiPool[i % clientiPool.length],
        persone: 2 + (i % 6),
        createdAt: seed - i * 45_000,
        stato: stati[i],
        rush: i === 2,
        items,
      }
    })
    setExtraOrders(curr => [...curr, ...nuovi])
    setResetKey(k => k + 1)
  }

  const resetAll = () => {
    setExtraOrders([])
    setResetKey(k => k + 1)
  }

  const baseOrders = role === 'cucina' ? MOCK_CUCINA : MOCK_BAR
  const allOrders  = [...baseOrders, ...extraOrders]

  return (
    <div className="min-h-screen bg-bg text-text font-ui">
      {/* Toolbar fissa in alto (solo demo, non parte del KDS) */}
      <div className="fixed top-2 left-2 z-50 flex items-center gap-2 px-3 py-2
                      bg-bg/85 backdrop-blur border border-borderSoft rounded-card-lg shadow-lg
                      flex-wrap max-w-[calc(100vw-1rem)]">
        <span className="text-[10px] font-extrabold uppercase tracking-[1.6px] text-gold">
          Demo · KDS v2
        </span>
        <div className="w-px h-5 bg-borderSoft" />
        <DemoBtn active={role === 'cucina'} onClick={() => setRole('cucina')} icon={ChefHat}>Cucina</DemoBtn>
        <DemoBtn active={role === 'bar'}    onClick={() => setRole('bar')}    icon={Beer}>Bar</DemoBtn>
        <div className="w-px h-5 bg-borderSoft" />
        <DemoBtn onClick={() => setNoteOpen(true)} icon={Eye}>Note modal</DemoBtn>
        <DemoBtn onClick={addStressBatch}     icon={Plus}>+10 stress</DemoBtn>
        <DemoBtn onClick={resetAll}           icon={Zap}>Reset</DemoBtn>
        {extraOrders.length > 0 && (
          <span className="text-[10px] font-mono text-textSoft tabular-nums">
            (+{extraOrders.length} stress)
          </span>
        )}
      </div>

      {/* viewport tablet — fullscreen */}
      <div className="w-full" style={{ minHeight: '100vh' }}>
        <KDSLayout
          key={`${role}-${resetKey}`}
          role={role}
          servizio="cena"
          initialOrders={allOrders}
          onLogout={() => alert('Logout (demo)')}
        />
      </div>

      <NoteModal
        open={noteOpen}
        dishName="Coniglio in porchetta"
        currentQty={4}
        notes={DEFAULT_NOTES}
        initialSelected={appliedNotes}
        onClose={() => setNoteOpen(false)}
        onConfirm={(notes) => {
          setAppliedNotes(notes)
          setNoteOpen(false)
          alert(`Salvate ${notes.length} note:\n${notes.map(n => `• ${n.icon} ${n.label} ×${n.qty ?? ''}`).join('\n')}`)
        }}
      />
    </div>
  )
}

function DemoBtn({ active, onClick, icon: Icon, children }) {
  return (
    <button
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 px-2 h-7 rounded-btn text-[11px]',
        'font-extrabold uppercase tracking-[1px] transition-transform active:scale-95',
        active ? 'bg-gold text-bg' : 'bg-surfaceElev text-textSoft hover:text-text',
      ].join(' ')}
    >
      <Icon size={13} strokeWidth={2.6} />
      {children}
    </button>
  )
}

/* ────────────────────────────────────────────
   MOCK DATA — realistici marchigiani da spec
   ──────────────────────────────────────────── */

const now = Date.now()
const minAgo = (m, s = 0) => now - m * 60_000 - s * 1000

const MOCK_CUCINA = [
  // ── DA FARE ──
  {
    id: 't3',
    tavolo: 3,
    cliente: 'Mattia',
    persone: 4,
    createdAt: minAgo(12, 15),   // mostra 12:15+ (urgente, ma forziamo timer rosso)
    stato: 'sbloccata',
    rush: true,
    items: [
      { nome: 'Vincisgrassi al ragù', q: 4 },
      { nome: 'Antipasto misto del contadino', q: 2 },
    ],
  },
  {
    id: 't7',
    tavolo: 7,
    cliente: 'Sara',
    persone: 6,
    createdAt: minAgo(4, 45),
    stato: 'sbloccata',
    rush: false,
    items: [
      { nome: 'Tagliatelle al ragù di cinghiale', q: 6 },
      { nome: 'Olive ascolane fritte', q: 3 },
    ],
  },
  {
    id: 't12',
    tavolo: 12,
    cliente: 'Bruno',
    persone: 4,
    createdAt: minAgo(1, 30),
    stato: 'pre_riscaldo',
    rush: false,
    items: [
      { nome: 'Passatelli in brodo', q: 4 },
    ],
  },

  // ── IN CORSO ──
  {
    id: 't5',
    tavolo: 5,
    cliente: 'Marco',
    persone: 8,
    createdAt: minAgo(8, 20),
    stato: 'in_preparazione',
    rush: false,
    items: [
      { nome: 'Porchetta arrosto', q: 8 },
      {
        nome: 'Coniglio in porchetta',
        q: 4,
        note: [
          { id: 'sangue', icon: '🩸', label: 'al sangue ×2', color: '#E84040' },
        ],
      },
    ],
  },
  {
    id: 't9',
    tavolo: 9,
    cliente: 'Elena',
    persone: 4,
    createdAt: minAgo(6, 10),
    stato: 'in_preparazione',
    rush: false,
    items: [
      {
        nome: "Scottadito di agnello",
        q: 4,
        note: [
          { id: 'no_glutine', icon: '🌾', label: 'no glutine ×1', color: '#D4A043' },
        ],
      },
    ],
  },

  // ── IN FINESTRA ──
  {
    id: 't1',
    tavolo: 1,
    cliente: 'Mario',
    persone: 5,
    createdAt: minAgo(12, 30),
    stato: 'in_finestra',
    rush: false,
    items: [
      { nome: 'Antipasto misto', q: 5 },
    ],
  },
  {
    id: 't14',
    tavolo: 14,
    cliente: 'Carla',
    persone: 2,
    createdAt: minAgo(9, 45),
    stato: 'in_finestra',
    rush: false,
    items: [
      { nome: 'Bruschette al pomodoro', q: 2 },
    ],
  },
]

const MOCK_BAR = [
  {
    id: 'b3',
    tavolo: 3,
    cliente: 'Mattia',
    persone: 4,
    createdAt: minAgo(11, 5),
    stato: 'sbloccata',
    rush: true,
    items: [
      { nome: 'Verdicchio Castelli di Jesi', q: 2 },
      { nome: 'Acqua frizzante 1L', q: 2 },
    ],
  },
  {
    id: 'b7',
    tavolo: 7,
    cliente: 'Sara',
    persone: 6,
    createdAt: minAgo(3, 10),
    stato: 'sbloccata',
    rush: false,
    items: [
      { nome: "Lacrima di Morro d'Alba", q: 1 },
      { nome: 'Acqua naturale 1L', q: 3 },
    ],
  },
  {
    id: 'b9',
    tavolo: 9,
    cliente: 'Elena',
    persone: 4,
    createdAt: minAgo(7, 30),
    stato: 'in_preparazione',
    rush: false,
    items: [
      { nome: 'Caffè', q: 4 },
      { nome: 'Mistrà', q: 2 },
    ],
  },
  {
    id: 'b1',
    tavolo: 1,
    cliente: 'Mario',
    persone: 5,
    createdAt: minAgo(13, 0),
    stato: 'in_finestra',
    rush: false,
    items: [
      { nome: 'Vino sfuso rosso 1L', q: 2 },
    ],
  },
]
