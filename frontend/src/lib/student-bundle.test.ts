import { describe, expect, it } from 'vitest'
import { buildStudentBundle, STUDENT_BUNDLE_SCHEMA_VERSION } from './student-bundle'

describe('buildStudentBundle', () => {
  it('returns empty bundle for null profile', () => {
    const b = buildStudentBundle(null)
    expect(b.schemaVersion).toBe(STUDENT_BUNDLE_SCHEMA_VERSION)
    expect(b.meta.defaultQuarterCode).toBe('20262')
    expect(b.majors).toEqual([])
    expect(b.graphEdges).toEqual([])
  })

  it('counts overlap between completed and Stats & DS major requirements', () => {
    const b = buildStudentBundle({
      major: 'stats_ds_bs',
      completed_courses: ['MATH 2A', 'MATH 2B'],
      in_progress_courses: ['PSTAT 10'],
      course_grades: { 'MATH 2A': 'A', 'MATH 2B': 'B+' },
      cumulative_gpa: 3.5,
      transfer_units: 0,
      ap_credits: [],
    })
    expect(b.meta.defaultQuarterCode).toBe('20262')
    expect(b.majors.some((m) => m.id === 'stats_ds_bs')).toBe(true)
    expect(b.derived.numCompleted).toBe(2)
    expect(b.derived.numInProgress).toBe(1)
    expect(b.derived.overlapCompletedWithMajorRequirements).toBeGreaterThanOrEqual(1)
    expect(b.graphEdges.some((e) => e.type === 'completed' && e.to === 'MATH 2A')).toBe(true)
    expect(b.graphEdges.some((e) => e.type === 'required_by_major' && e.from === 'MATH 2A')).toBe(
      true,
    )
  })

  it('counts AP calculus toward MATH 2A/2B-style requirements via placement expansion', () => {
    const b = buildStudentBundle({
      major: 'stats_ds_bs',
      completed_courses: [],
      in_progress_courses: [],
      course_grades: {},
      cumulative_gpa: null,
      transfer_units: 0,
      ap_credits: [
        {
          exam: 'Calculus BC',
          ucsb_equivalent: ['MATH 3A', 'MATH 3B'],
          units: 8,
          score: 5,
        },
      ],
    })
    expect(b.derived.overlapCompletedWithMajorRequirements).toBeGreaterThanOrEqual(2)
    expect(b.graphEdges.some((e) => e.type === 'completed' && e.to === 'MATH 2A')).toBe(true)
    expect(b.graphEdges.some((e) => e.type === 'completed' && e.to === 'MATH 2B')).toBe(true)
  })
})
