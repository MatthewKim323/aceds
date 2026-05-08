import { type OptimizePreferences } from '../lib/api'

type Props = {
  prefs: OptimizePreferences
  onChange: (next: OptimizePreferences) => void
}

export function OptimizerPreferencesEditor({ prefs, onChange }: Props) {
  return (
    <>
      <div className="sb-prefs-grid">
        <OptimizerWeight
          label="Grades"
          value={prefs.weight_grades}
          onChange={(v) => onChange({ ...prefs, weight_grades: v })}
        />
        <OptimizerWeight
          label="Professor"
          value={prefs.weight_professor}
          onChange={(v) => onChange({ ...prefs, weight_professor: v })}
        />
        <OptimizerWeight
          label="Convenience"
          value={prefs.weight_convenience}
          onChange={(v) => onChange({ ...prefs, weight_convenience: v })}
        />
        <OptimizerWeight
          label="Availability"
          value={prefs.weight_availability}
          onChange={(v) => onChange({ ...prefs, weight_availability: v })}
        />
      </div>

      <div className="sb-row">
        <label className="sb-field">
          <span>Target units</span>
          <div className="sb-range-pair">
            <input
              type="number"
              min={4}
              max={22}
              value={prefs.target_units_min}
              onChange={(e) =>
                onChange({ ...prefs, target_units_min: Number(e.target.value) })
              }
            />
            <span className="sb-dash">—</span>
            <input
              type="number"
              min={4}
              max={22}
              value={prefs.target_units_max}
              onChange={(e) =>
                onChange({ ...prefs, target_units_max: Number(e.target.value) })
              }
            />
          </div>
        </label>
        <label className="sb-field">
          <span>Earliest start</span>
          <input
            type="time"
            value={prefs.earliest_start}
            onChange={(e) => onChange({ ...prefs, earliest_start: e.target.value })}
          />
        </label>
        <label className="sb-field">
          <span>Latest end</span>
          <input
            type="time"
            value={prefs.latest_end}
            onChange={(e) => onChange({ ...prefs, latest_end: e.target.value })}
          />
        </label>
        <label className="sb-field sb-field-check">
          <input
            type="checkbox"
            checked={prefs.avoid_friday_afternoon}
            onChange={(e) =>
              onChange({ ...prefs, avoid_friday_afternoon: e.target.checked })
            }
          />
          <span>Skip Fri afternoons</span>
        </label>
      </div>

      <div className="sb-row">
        <label className="sb-field sb-field-wide">
          <span>Risk aversion λ (grade term)</span>
          <div className="sb-risk-row">
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={prefs.risk_lambda ?? 0}
              onChange={(e) =>
                onChange({ ...prefs, risk_lambda: Number(e.target.value) })
              }
            />
            <span className="sb-risk-val">{(prefs.risk_lambda ?? 0).toFixed(2)}</span>
          </div>
          <small className="sb-hint-inline">
            Optimizer uses effective GPA ≈ μ − λ·half-width on the grade axis (PuLP objective only).
          </small>
        </label>
      </div>

      <div className="sb-row">
        <span className="sb-field-label">Days</span>
        {(['M', 'T', 'W', 'R', 'F', 'S'] as const).map((d) => {
          const active = prefs.preferred_days.includes(d)
          return (
            <button
              key={d}
              type="button"
              className={`sb-day ${active ? 'on' : ''}`}
              onClick={() => {
                const set = new Set(prefs.preferred_days)
                if (active) set.delete(d)
                else set.add(d)
                onChange({ ...prefs, preferred_days: Array.from(set) })
              }}
            >
              {d}
            </button>
          )
        })}
      </div>
    </>
  )
}

function OptimizerWeight({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (n: number) => void
}) {
  return (
    <label className="sb-weight">
      <div className="sb-weight-head">
        <span>{label}</span>
        <span className="sb-weight-val">{(value * 100).toFixed(0)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
