import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

// ── Types ──

export interface ParsedCourse {
  course_code: string
  grade: string
  quarter: string
  units: number
}

export interface APCredit {
  exam: string
  ucsb_equivalent: string[]
  units: number
  score: number | null
}

export interface RequirementStatus {
  [key: string]: string | Record<string, unknown> | null
}

export interface ParsedDocument {
  document_type: 'academic_history' | 'transcript'
  completed_courses: ParsedCourse[]
  in_progress_courses: ParsedCourse[]
  ap_credits: APCredit[]
  course_grades: Record<string, string>
  requirement_status: RequirementStatus | null
  cumulative_gpa: number | null
  transfer_units: number
  total_units: number
}

// ── PDF text extraction — reconstruct lines by y-position ──

async function extractText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const allLines: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()

    // Group text items by their y-coordinate to reconstruct lines
    const lineMap = new Map<number, { x: number; str: string }[]>()

    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const tx = item.transform
      const y = Math.round(tx[5]) // round y to group items on same line
      const x = tx[4]
      if (!lineMap.has(y)) lineMap.set(y, [])
      lineMap.get(y)!.push({ x, str: item.str })
    }

    // Sort lines by y descending (PDF coords: bottom=0), then items by x
    const sortedYs = [...lineMap.keys()].sort((a, b) => b - a)
    for (const y of sortedYs) {
      const items = lineMap.get(y)!
      items.sort((a, b) => a.x - b.x)
      const line = items.map((it) => it.str).join(' ')
      allLines.push(line)
    }
  }

  return allLines.join('\n')
}

// ── Quarter code map ──

const QTR_MAP: Record<string, string> = {
  F: 'Fall', W: 'Winter', S: 'Spring', U: 'Summer',
}

function expandQuarter(code: string): string {
  // F24 → Fall 2024, W25 → Winter 2025, S26 → Spring 2026
  const season = QTR_MAP[code.charAt(0)]
  const yr = parseInt('20' + code.slice(1))
  return season ? `${season} ${yr}` : code
}

// ── Detect document type ──

function detectDocumentType(text: string): 'academic_history' | 'transcript' {
  if (
    text.includes('Major Progress Check') ||
    text.includes('ACADEMIC HISTORY') ||
    text.includes('Requirement') ||
    text.includes('Area A') ||
    text.includes('_____')
  ) {
    return 'academic_history'
  }
  return 'transcript'
}

// ── Academic History parser ──
// Format: lines like "F24 CMPSC 8 4.0 B+ INTRO TO COMP SCI"
// AP lines:         "S23 AP-ENGL-A1 8.0 AP4 AP English"
// In-progress:      "S26 ECON 10A 0.0 MICROECON THEORY" (0.0 units, no grade)

function parseAcademicHistory(text: string): ParsedDocument {
  const completed: ParsedCourse[] = []
  const inProgress: ParsedCourse[] = []
  const courseGrades: Record<string, string> = {}
  const apCredits: APCredit[] = []
  const reqStatus: RequirementStatus = {}

  let cumulativeGpa: number | null = null
  let transferUnits = 0
  let totalUnits = 0
  const seenCourses = new Set<string>()

  const lines = text.split('\n')

  // ── Extract courses ──
  // Pattern: QTR_CODE DEPT NUM UNITS GRADE COURSE_NAME
  // e.g., "F24 CMPSC 8 4.0 B+ INTRO TO COMP SCI"
  // e.g., "S25 MUS 16 5.0 A LISTENING TO JAZZ"
  // e.g., "W26 PSTAT 120B 4.0 B+ PROB & STATISTICS"
  // AP:   "S23 AP-ENGL-A1 8.0 AP4 AP English"
  // IP:   "S26 ECON 10A 0.0 MICROECON THEORY"

  const courseRe =
    /^([FWSU]\d{2})\s+([A-Z][A-Z &]+?)\s+(\d{1,3}[A-Z]{0,2})\s+(\d+\.\d)\s+(A[+-]?|B[+-]?|C[+-]?|D[+-]?|F|P|NP|W|I)\s+/

  const courseNoGradeRe =
    /^([FWSU]\d{2})\s+([A-Z][A-Z &]+?)\s+(\d{1,3}[A-Z]{0,2})\s+0\.0\s+/

  const apLineRe =
    /^([FWSU]\d{2})\s+(AP[- ][A-Z0-9 ]+?)\s+(\d+\.\d)\s+(AP\d)\s+(.+)/

  for (const line of lines) {
    // Try AP credit line first
    const apMatch = line.match(apLineRe)
    if (apMatch) {
      const apCode = apMatch[2].trim()
      const units = parseFloat(apMatch[3])
      const scoreStr = apMatch[4] // AP3, AP4, AP5
      const score = parseInt(scoreStr.replace('AP', ''))
      const examName = apMatch[5].trim()

      // Map AP code to UCSB equivalent
      const equivs: string[] = []
      if (apCode.startsWith('AP-')) {
        // These are non-course AP credits (AP-ENGL-A1, AP-AMER, etc.)
      } else if (apCode.includes('COMP SCI P')) {
        equivs.push('AP COMP SCI P')
      } else {
        equivs.push(apCode)
      }

      apCredits.push({ exam: examName, ucsb_equivalent: equivs, units, score })
      continue
    }

    // Try regular course with grade
    const courseMatch = line.match(courseRe)
    if (courseMatch) {
      const qtr = expandQuarter(courseMatch[1])
      const dept = courseMatch[2].trim()
      const num = courseMatch[3]
      const units = parseFloat(courseMatch[4])
      const grade = courseMatch[5]
      const code = `${dept} ${num}`

      if (seenCourses.has(code)) continue
      seenCourses.add(code)

      const course: ParsedCourse = { course_code: code, grade, quarter: qtr, units }
      completed.push(course)
      if (grade !== 'W') courseGrades[code] = grade
      continue
    }

    // Try in-progress course (0.0 units, no grade)
    const ipMatch = line.match(courseNoGradeRe)
    if (ipMatch) {
      const qtr = expandQuarter(ipMatch[1])
      const dept = ipMatch[2].trim()
      const num = ipMatch[3]
      const code = `${dept} ${num}`

      if (seenCourses.has(code)) continue
      seenCourses.add(code)

      inProgress.push({ course_code: code, grade: 'IP', quarter: qtr, units: 4 })
      continue
    }
  }

  // ── Extract GPA ──
  // Pattern: "66.00 Units 233.40 Points 3.53 GPA"
  // Take the LAST overall GPA (the cumulative one)
  const gpaRe = /(\d+\.\d+)\s+Units\s+(\d+\.\d+)\s+Points\s+(\d+\.\d+)\s+GPA/g
  let gpaMatch
  while ((gpaMatch = gpaRe.exec(text)) !== null) {
    cumulativeGpa = parseFloat(gpaMatch[3])
  }

  // ── Transfer units ──
  const transferRe = /(?:Advanced Placement Examination|Transfer)[\s\S]*?(\d+\.?\d*)\s+Completed/gi
  let tMatch
  while ((tMatch = transferRe.exec(text)) !== null) {
    transferUnits = Math.max(transferUnits, parseFloat(tMatch[1]))
  }

  // ── Total units ──
  const totalRe = /(\d+\.\d+)\s+Completed/g
  let uMatch
  while ((uMatch = totalRe.exec(text)) !== null) {
    totalUnits = Math.max(totalUnits, parseFloat(uMatch[1]))
  }

  // ── Requirement statuses ──
  let hasReqs = false

  // OK/No requirement lines
  const reqLineRe = /^(OK|No|IP)\s+(.+)/

  let currentReq = ''
  for (const line of lines) {
    const reqMatch = line.match(reqLineRe)
    if (reqMatch) {
      const status = reqMatch[1]
      const name = reqMatch[2].trim()

      const key = nameToKey(name)
      if (key) {
        reqStatus[key] = status === 'OK' ? 'OK' : (status === 'IP' ? 'In Progress' : `NEEDS`)
        currentReq = key
        hasReqs = true
      }
    }

    // Check for "NEEDS X units" or "NEEDS X Course" lines
    if (currentReq && reqStatus[currentReq] === 'NEEDS') {
      const needsMatch = line.match(/NEEDS\s+(.+)/i)
      if (needsMatch) {
        reqStatus[currentReq] = `NEEDS ${needsMatch[1].trim()}`
      }
    }
  }

  // ── Unit requirements from the doc ──
  const unitNeedMatch = text.match(/Minimum of 180.*?(\d+\.\d+)\s+Completed[\s\S]*?NEEDS\s+(\d+\.\d+)\s+units/i)
  if (unitNeedMatch) {
    reqStatus['unit_requirements'] = {
      total_needed: 180,
      total_completed: parseFloat(unitNeedMatch[1]),
      total_remaining: parseFloat(unitNeedMatch[2]),
    }
  }

  // UD units
  const udMatch = text.match(/Minimum of 60\.0 Upper-division.*?(\d+\.\d+)\s+Completed[\s\S]*?NEEDS\s+(\d+\.\d+)\s+units/i)
  if (udMatch) {
    reqStatus['ud_units'] = {
      total_needed: 60,
      total_completed: parseFloat(udMatch[1]),
      total_remaining: parseFloat(udMatch[2]),
    }
  }

  // Major GPA
  const majorGpaMatch = text.match(/2\.0 UC GPA required.*?overall major.*?(\d+\.\d+)\s+Units\s+(\d+\.\d+)\s+Points\s+(\d+\.\d+)\s+GPA/is)
  if (majorGpaMatch) {
    reqStatus['major_gpa'] = {
      overall: parseFloat(majorGpaMatch[3]),
    }
  }

  const udGpaMatch = text.match(/2\.0 UC GPA required.*?upper-division major.*?(\d+\.\d+)\s+Units\s+(\d+\.\d+)\s+Points\s+(\d+\.\d+)\s+GPA/is)
  if (udGpaMatch) {
    reqStatus['ud_major_gpa'] = {
      upper_div: parseFloat(udGpaMatch[3]),
    }
  }

  return {
    document_type: 'academic_history',
    completed_courses: completed,
    in_progress_courses: inProgress,
    ap_credits: apCredits,
    course_grades: courseGrades,
    requirement_status: hasReqs ? reqStatus : null,
    cumulative_gpa: cumulativeGpa,
    transfer_units: transferUnits,
    total_units: totalUnits || completed.reduce((s, c) => s + c.units, 0) + transferUnits,
  }
}

function nameToKey(name: string): string | null {
  const n = name.toLowerCase()
  if (n.includes('area a') && n.includes('reading')) return 'ge_area_a1'
  if (n.includes('area a') && n.includes('english') && !n.includes('reading')) return 'ge_area_a1'
  if (n.includes('area b')) return 'ge_area_b'
  if (n.includes('area c')) return 'ge_area_c'
  if (n.includes('area d')) return 'ge_area_d'
  if (n.includes('area e')) return 'ge_area_e'
  if (n.includes('area f')) return 'ge_area_f'
  if (n.includes('area g')) return 'ge_area_g'
  if (n.includes('writing req')) return 'ge_writing'
  if (n.includes('quantitative')) return 'ge_quantitative'
  if (n.includes('world culture')) return 'ge_world_cultures'
  if (n.includes('ethnicity')) return 'ge_ethnicity'
  if (n.includes('foreign lang')) return 'ge_area_b'
  if (n.includes('entry level writing')) return 'entry_level_writing'
  if (n.includes('american hist')) return 'american_history'
  if (n.includes('pre-major') || n.includes('pre major')) return 'pre_major'
  if (n.includes('preparation for')) return 'preparation_for_major'
  if (n.includes('upper-division major') || n.includes('upper division major')) return 'upper_div_major'
  if (n.includes('unit requirement')) return 'unit_reqs'
  if (n.includes('university gpa')) return 'university_gpa'
  if (n.includes('major gpa')) return 'major_gpa_req'
  if (n.includes('letter grade req')) return 'letter_grade_req'
  if (n.includes('three-term') || n.includes('three term')) return 'three_term_residence'
  if (n.includes('academic residence') && n.includes('35')) return 'academic_residence_35'
  if (n.includes('declaration of degree')) return 'degree_candidacy'
  return null
}

// ── Transcript parser ──
// The transcript has a different format entirely:
// "CMPSC 8 -INTRO TO COMP"
// "SCI B+ 51300 4.0 4.0 4.0 13.20"  (grade line may be on next line)
// Quarter headers: "Fall 2024", "Winter 2025"
// Cumulative: "Cumulative Total (Undergrad) GPA 3.53 72.0 72.0 66.0 233.40"

function parseTranscript(text: string): ParsedDocument {
  const completed: ParsedCourse[] = []
  const inProgress: ParsedCourse[] = []
  const courseGrades: Record<string, string> = {}

  let cumulativeGpa: number | null = null
  let transferUnits = 0
  let totalUnits = 0
  let currentQuarter = ''
  const seenCourses = new Set<string>()

  const lines = text.split('\n')

  // Detect quarter headers
  const quarterHeaderRe = /^(Fall|Winter|Spring|Summer)\s+(\d{4})$/

  // Course start: "CMPSC 8 -INTRO TO COMP" or "ECON 1 -PRINCIPL ECON"
  // Sometimes the course+grade is on same line:
  // "MATH 4A -LIN ALG W/APPS A 30916 4.0 4.0 4.0 16.00"
  // Sometimes split:
  // "CMPSC 8 -INTRO TO COMP"
  // "SCI B+ 51300 4.0 4.0 4.0 13.20"

  // Strategy: look for lines that contain a grade pattern + enrollment code + units
  // and combine with previous course-start line if needed

  // First pass: find course+grade patterns
  // Full line pattern: DEPT NUM -NAME GRADE ENRLCD ATT COMP GPA POINTS
  const fullLineRe =
    /^([A-Z][A-Z &]+?)\s+(\d{1,3}[A-Z]{0,2})\s+-[A-Z].*?\s+(A[+-]?|B[+-]?|C[+-]?|D[+-]?|F|P|NP|W|I)\s+(\d{4,5})\s+(\d+\.\d)\s+(\d+\.\d)\s+(\d+\.\d)/

  // Course start (no grade on this line): DEPT NUM -COURSENAME
  const courseStartRe = /^([A-Z][A-Z &]+?)\s+(\d{1,3}[A-Z]{0,2})\s+-[A-Z]/

  // Grade continuation: SOMETHING GRADE ENRLCD UNITS...
  const gradeContRe =
    /^\S+\s+(A[+-]?|B[+-]?|C[+-]?|D[+-]?|F|P|NP|W|I)\s+(\d{4,5})\s+(\d+\.\d)\s+(\d+\.\d)\s+(\d+\.\d)/

  // In-progress continuation: no grade, just ENRLCD UNITS 0.0 0.0 0.0
  const ipContRe = /^\S*\s*(\d{4,5})\s+(\d+\.\d)\s+0\.0\s+0\.0\s+0\.00/

  // In-progress full line: DEPT NUM -NAME ENRLCD UNITS 0.0 0.0 0.00
  const ipFullRe =
    /^([A-Z][A-Z &]+?)\s+(\d{1,3}[A-Z]{0,2})\s+-[A-Z].*?\s+(\d{4,5})\s+(\d+\.\d)\s+0\.0\s+0\.0\s+0\.00/

  let pendingCourse: { dept: string; num: string } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // Quarter header
    const qm = line.match(quarterHeaderRe)
    if (qm) {
      currentQuarter = `${qm[1]} ${qm[2]}`
      continue
    }

    // Cumulative GPA
    const cumMatch = line.match(
      /Cumulative Total.*?GPA\s+(\d+\.\d+)\s+(\d+\.\d+)/,
    )
    if (cumMatch) {
      cumulativeGpa = parseFloat(cumMatch[1])
      totalUnits = parseFloat(cumMatch[2])
      continue
    }

    // Transfer units
    const trMatch = line.match(/Transfer Work.*?Total:\s*(\d+\.?\d*)/i)
    if (trMatch) {
      transferUnits = parseFloat(trMatch[1])
      continue
    }

    // Try in-progress full line
    const ipFull = line.match(ipFullRe)
    if (ipFull) {
      const code = `${ipFull[1].trim()} ${ipFull[2]}`
      if (!seenCourses.has(code)) {
        seenCourses.add(code)
        inProgress.push({
          course_code: code,
          grade: 'IP',
          quarter: currentQuarter,
          units: parseFloat(ipFull[4]),
        })
      }
      pendingCourse = null
      continue
    }

    // Try full line with grade
    const full = line.match(fullLineRe)
    if (full) {
      const code = `${full[1].trim()} ${full[2]}`
      const grade = full[3]
      const units = parseFloat(full[5])

      if (!seenCourses.has(code)) {
        seenCourses.add(code)
        completed.push({ course_code: code, grade, quarter: currentQuarter, units })
        if (grade !== 'W') courseGrades[code] = grade
      }
      pendingCourse = null
      continue
    }

    // Try course start (will need continuation on next line)
    const cs = line.match(courseStartRe)
    if (cs) {
      pendingCourse = { dept: cs[1].trim(), num: cs[2] }
      continue
    }

    // Try grade continuation for pending course
    if (pendingCourse) {
      const gc = line.match(gradeContRe)
      if (gc) {
        const code = `${pendingCourse.dept} ${pendingCourse.num}`
        const grade = gc[1]
        const units = parseFloat(gc[3])

        if (!seenCourses.has(code)) {
          seenCourses.add(code)
          completed.push({ course_code: code, grade, quarter: currentQuarter, units })
          if (grade !== 'W') courseGrades[code] = grade
        }
        pendingCourse = null
        continue
      }

      // Try IP continuation
      const ipc = line.match(ipContRe)
      if (ipc) {
        const code = `${pendingCourse.dept} ${pendingCourse.num}`
        if (!seenCourses.has(code)) {
          seenCourses.add(code)
          inProgress.push({
            course_code: code,
            grade: 'IP',
            quarter: currentQuarter,
            units: parseFloat(ipc[2]),
          })
        }
        pendingCourse = null
        continue
      }

      // If we got a totally different line, discard pending
      pendingCourse = null
    }
  }

  return {
    document_type: 'transcript',
    completed_courses: completed,
    in_progress_courses: inProgress,
    ap_credits: [],
    course_grades: courseGrades,
    requirement_status: null,
    cumulative_gpa: cumulativeGpa,
    transfer_units: transferUnits,
    total_units: totalUnits || completed.reduce((s, c) => s + c.units, 0) + transferUnits,
  }
}

// ── Main parse function ──

export async function parsePDF(file: File): Promise<ParsedDocument> {
  const text = await extractText(file)
  console.log('[ACE PDF Parser] extracted text length:', text.length)
  console.log('[ACE PDF Parser] first 500 chars:', text.slice(0, 500))

  const docType = detectDocumentType(text)
  console.log('[ACE PDF Parser] detected type:', docType)

  const result = docType === 'academic_history'
    ? parseAcademicHistory(text)
    : parseTranscript(text)

  console.log('[ACE PDF Parser] completed:', result.completed_courses.length,
    'in-progress:', result.in_progress_courses.length,
    'GPA:', result.cumulative_gpa,
    'AP:', result.ap_credits.length)

  return result
}

export function computeStats(
  doc: ParsedDocument,
  majorGroups?: { label: string; courses: { id: string; alt?: string }[] }[],
) {
  const totalCompleted = doc.completed_courses.length
  const totalInProgress = doc.in_progress_courses.length
  const completedIds = new Set(doc.completed_courses.map((c) => c.course_code))

  let majorCoursesCompleted = 0
  let majorCoursesTotal = 0
  if (majorGroups) {
    for (const group of majorGroups) {
      majorCoursesTotal += group.courses.length
      for (const course of group.courses) {
        if (completedIds.has(course.id) || (course.alt && completedIds.has(course.alt))) {
          majorCoursesCompleted++
        }
      }
    }
  }

  const unitsCompleted =
    doc.completed_courses.reduce((s, c) => s + c.units, 0) + doc.transfer_units
  const unitsTotal = 180

  // GPA from grades
  const gradePoints: Record<string, number> = {
    'A+': 4.0, 'A': 4.0, 'A-': 3.7,
    'B+': 3.3, 'B': 3.0, 'B-': 2.7,
    'C+': 2.3, 'C': 2.0, 'C-': 1.7,
    'D+': 1.3, 'D': 1.0, 'D-': 0.7,
    'F': 0.0,
  }

  let weightedSum = 0
  let totalGradeUnits = 0
  for (const c of doc.completed_courses) {
    const gp = gradePoints[c.grade]
    if (gp !== undefined) {
      weightedSum += gp * c.units
      totalGradeUnits += c.units
    }
  }

  const calculatedGpa = totalGradeUnits > 0 ? weightedSum / totalGradeUnits : null
  const gpa = doc.cumulative_gpa ?? calculatedGpa

  const quarters = new Set(
    doc.completed_courses.map((c) => c.quarter).filter(Boolean),
  )

  return {
    gpa: gpa ? parseFloat(gpa.toFixed(2)) : null,
    totalCourses: totalCompleted,
    inProgressCourses: totalInProgress,
    majorCoursesCompleted,
    majorCoursesRemaining: majorCoursesTotal - majorCoursesCompleted,
    majorCoursesTotal,
    unitsCompleted,
    unitsTotal,
    unitsRemaining: Math.max(0, unitsTotal - unitsCompleted),
    transferUnits: doc.transfer_units,
    quartersCompleted: quarters.size,
    apCredits: doc.ap_credits.length,
  }
}
