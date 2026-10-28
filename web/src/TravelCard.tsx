import { AA_FUEL_PAGE, euroText, FUEL_PRICE_FRESH_DAYS, type FuelPriceFound, irishToday, money, parseEuro, travelSettingsOf, type MoneyView, type TravelSettings } from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Refusal, useAct } from './act.tsx'
import { Pending } from './StatusPill.tsx'
import { ask } from './server.ts'
import { client } from './sync.ts'

type Fields = { from: string; fuel: string; use: string; perCar: string; perDiem: string }
/** The fuel price as the pumps write it: €1.749 a litre. */
const litreText = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(3))
const fieldsOf = (t: TravelSettings): Fields => ({ from: String(t.fromKm), fuel: litreText(t.fuelCentsPerLitre), use: String(t.litresPer100Km), perCar: String(t.crewPerCar), perDiem: t.perDiemCents === null ? '' : euroText(t.perDiemCents) })
const same = (a: Fields, b: Fields) => a.from === b.from && a.fuel === b.fuel && a.use === b.use && a.perCar === b.perCar && a.perDiem === b.perDiem
const num = (s: string) => Number(s.trim().replace(',', '.').replace(/^€\s*/, ''))

/** "1.749" or "€1.75" a litre, or "174.9" cent a litre, as cent a litre to one place; NaN for neither. */
function readFuel(s: string): number {
  const n = num(s.replace(/c$/i, ''))
  if (!Number.isFinite(n)) return NaN
  return Math.round((n < 10 ? n * 100 : n) * 10) / 10
}

/**
 * How the crew's travel and subsistence are charged on quotes (ADR 0086):
 * past how far from Dublin city centre travel is charged, the fuel price and
 * what a car uses and how many crew share one, and the per diem. Money's, beside Printed quotes.
 * The fuel price comes from AA Ireland's monthly survey: the server reads
 * their page when asked and the figure is put in the box to save, so a
 * person always sees it before it prices a quote. The day it was set shows,
 * so it can be checked once a month.
 */
export function TravelCard({ money: m }: { money: MoneyView }) {
  const t = travelSettingsOf(m.quoting)
  const saved = fieldsOf(t)
  const [f, setF] = useState(saved)
  // As on Printed quotes: another device's change is followed, unless someone is part way through typing here.
  const [was, setWas] = useState(saved)
  if (!same(was, saved)) {
    setWas(saved)
    if (same(f, was)) setF(saved)
  }
  const { run, error, refuse } = useAct()
  const [aa, setAa] = useState<FuelPriceFound>()
  const [reading, setReading] = useState(false)
  const readAa = async () => {
    setReading(true)
    try {
      const found = await ask<FuelPriceFound>('/api/fuel-price')
      setAa(found)
      setF((x) => ({ ...x, fuel: litreText(found.centsPerLitre) }))
    } catch (err) {
      refuse(err instanceof Error ? err.message : "The AA's fuel prices couldn't be read just now. Open their page and type the diesel price in.")
    } finally {
      setReading(false)
    }
  }
  const today = irishToday()
  const save = (e: FormEvent) => {
    e.preventDefault()
    const from = num(f.from)
    if (!(Number.isInteger(from) && from >= 0 && from <= 1000)) return refuse('Travel starts at a whole number of km from 0 to 1,000.')
    const fuel = f.fuel.trim() ? readFuel(f.fuel) : null
    if (fuel !== null && !(fuel >= 50 && fuel <= 500)) return refuse('The fuel price is so much a litre, such as 1.749.')
    const use = num(f.use)
    if (!(use >= 1 && use <= 40 && Number.isInteger(Math.round(use * 1000) / 100))) return refuse('What a car uses is in litres for 100 km, from 1 to 40, such as 6.5.')
    const perCar = num(f.perCar)
    if (!(Number.isInteger(perCar) && perCar >= 1 && perCar <= 8)) return refuse('How many share a car is a whole number from 1 to 8.')
    const perDiem = parseEuro(f.perDiem)
    if (perDiem.reason) return refuse(`The per diem: ${perDiem.reason}`)
    // The survey a price came from: the one just read, if the box still says its price, else the one kept with it.
    const fuelMonth = aa && fuel === aa.centsPerLitre ? aa.month : fuel === t.fuelCentsPerLitre ? t.fuelMonth : null
    void run(() => client.mutate('quoting.travel', { travelFromKm: from, fuelCentsPerLitre: fuel, litresPer100Km: use, perDiemCents: perDiem.cents ?? null, on: today, fuelMonth, crewPerCar: perCar }))
  }
  // Turned on or off at once, with the figures as they're saved.
  const setAuto = (on: boolean) =>
    void run(() =>
      client.mutate('quoting.travel', {
        travelFromKm: t.fromKm,
        fuelCentsPerLitre: t.fuelCentsPerLitre,
        litresPer100Km: t.litresPer100Km,
        perDiemCents: t.perDiemCents,
        on: today,
        fuelAuto: on,
      })
    )
  const age = t.fuelSetOn ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${t.fuelSetOn}T12:00:00Z`)) / 86_400_000) : null
  // What 100 km each way comes to, so the figures can be checked against sense.
  const example = t.fuelCentsPerLitre === null ? null : Math.round(((200 * t.litresPer100Km) / 100) * t.fuelCentsPerLitre)
  return (
    <section className="card office" aria-labelledby="travel-title">
      <h2 id="travel-title">Travel and subsistence</h2>
      <p>
        Every quote works these out for itself. On a job further than the distance below from Dublin city centre, the crew's travel is charged: a car's
        fuel there and back for each crew day, or for each car load when crew share. Vans' fuel stays in the transport lines. Each of the crew is charged the per diem for every day they're quoted for, unless the quote says the job provides meals.
      </p>
      <form className="office-form" onSubmit={save}>
        <label>
          Travel after{' '}
          <span className="with-unit">
            <input inputMode="numeric" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-describedby="travel-from-hint" />
            km
          </span>
          <small id="travel-from-hint">Each way from Dublin city centre. Nearer than this, no travel is charged.</small>
        </label>
        <div className="fuel-field">
          <label>
            Fuel price, € a litre{' '}
            <input inputMode="decimal" value={f.fuel} onChange={(e) => setF({ ...f, fuel: e.target.value })} placeholder="1.749" aria-describedby="fuel-hint" />
            <small id="fuel-hint">
              {t.fuelSetOn
                ? `${t.fuelMonth ? `From the ${t.fuelMonth} survey, set` : 'Set'} ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}${age !== null && age > FUEL_PRICE_FRESH_DAYS ? ': worth checking.' : '.'} `
                : 'Not set yet, so no travel is charged. '}
              Diesel at the pump, from the{' '}
              <a href={AA_FUEL_PAGE} target="_blank" rel="noreferrer">
                AA's monthly survey
              </a>
              .{aa && ` Read from their ${aa.month} survey: save to use it.`}
            </small>
          </label>
          <button type="button" onClick={() => void readAa()} disabled={reading} aria-busy={reading}>
            {reading ? 'Reading the AA’s price…' : 'Read the AA’s price'}
          </button>
        </div>
        <label className="signal wide">
          <input type="checkbox" role="switch" checked={t.fuelAuto} onChange={(e) => setAuto(e.target.checked)} />
          <span>
            <b>Update the fuel price from the AA each month</b>
            <small>
              {t.fuelAuto
                ? 'The AA’s survey comes out on the second Monday of the month, and its price is taken the day it does. Turn this off to keep a price you typed.'
                : 'Off: the fuel price stays as saved here until someone changes it.'}
            </small>
          </span>
        </label>
        <label>
          A car uses, litres for 100 km{' '}
          <input inputMode="decimal" value={f.use} onChange={(e) => setF({ ...f, use: e.target.value })} aria-describedby="use-hint" />
          <small id="use-hint">{example === null ? 'On average, loaded.' : `So 100 km each way comes to ${money(example)} of fuel for one car.`}</small>
        </label>
        <label>
          Crew to a car{' '}
          <input inputMode="numeric" value={f.perCar} onChange={(e) => setF({ ...f, perCar: e.target.value })} aria-describedby="per-car-hint" />
          <small id="per-car-hint">{t.crewPerCar === 1 ? 'Each of the crew drives their own. Say 2 or 3 if they share.' : `Each car carries ${t.crewPerCar} of the crew, so a car trip is charged for every ${t.crewPerCar} crew days.`}</small>
        </label>
        <label>
          Per diem, € a day{' '}
          <input inputMode="decimal" value={f.perDiem} onChange={(e) => setF({ ...f, perDiem: e.target.value })} placeholder="None" aria-describedby="per-diem-hint" />
          <small id="per-diem-hint">For each of the crew, each day. {t.perDiemCents === null ? 'Not set yet, so no subsistence is charged.' : ''}</small>
        </label>
        <div className="actions wide">
          <button type="submit" className="primary">
            Save travel and subsistence
          </button>
          <Pending pending={m.quoting.pending} />
        </div>
      </form>
      <Refusal error={error} />
    </section>
  )
}
