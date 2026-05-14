// Cancella tutti gli ordini (e order_items) dal DB Supabase.
// Usa la anon key da .env.local — funziona se le RLS lo permettono.
import { readFile } from 'fs/promises'
import { createClient } from '@supabase/supabase-js'

const env = (await readFile('.env.local', 'utf-8'))
  .split('\n')
  .reduce((acc, line) => {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m) acc[m[1]] = m[2].replace(/^["']|["']$/g, '')
    return acc
  }, {})

const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Mancano VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(url, key)

// Conta prima
const { count: cItems0 } = await supabase
  .from('order_items').select('id', { count: 'exact', head: true })
const { count: cOrd0 } = await supabase
  .from('orders').select('id', { count: 'exact', head: true })
console.log(`Pre-cleanup: ${cOrd0} orders, ${cItems0} order_items`)

console.log('→ DELETE FROM order_items')
const { error: e1 } = await supabase
  .from('order_items').delete().not('id', 'is', null)
if (e1) { console.error('  ERR:', e1.message); process.exit(1) }

console.log('→ DELETE FROM orders')
const { error: e2 } = await supabase
  .from('orders').delete().not('id', 'is', null)
if (e2) { console.error('  ERR:', e2.message); process.exit(1) }

const { count: cItems1 } = await supabase
  .from('order_items').select('id', { count: 'exact', head: true })
const { count: cOrd1 } = await supabase
  .from('orders').select('id', { count: 'exact', head: true })
console.log(`Post-cleanup: ${cOrd1} orders, ${cItems1} order_items`)
console.log(cOrd1 === 0 && cItems1 === 0 ? '✅ DB pulito' : '⚠ righe rimanenti')
