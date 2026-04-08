export interface CourseOption {
  id: string
  alt?: string
}

export interface CourseGroup {
  label: string
  courses: CourseOption[]
  pick?: number
  note?: string
}

export interface Major {
  id: string
  name: string
  degree: string
  year: string
  department: string
  college: string
  preMajorGpa: number
  groups: CourseGroup[]
}

export const majors: Major[] = [
  {
    id: 'stats_ds_bs',
    name: 'Statistics and Data Science',
    degree: 'B.S.',
    year: '2025–2026',
    department: 'Statistics and Applied Probability',
    college: 'College of Letters and Science',
    preMajorGpa: 2.5,
    groups: [
      {
        label: 'Pre-Major',
        note: 'All courses must be completed with a C or better. 2.5 GPA required.',
        courses: [
          { id: 'MATH 2A', alt: 'MATH 3A' },
          { id: 'MATH 2B', alt: 'MATH 3B' },
          { id: 'MATH 4A' },
          { id: 'MATH 4B' },
          { id: 'MATH 6A' },
          { id: 'MATH 8', alt: 'PSTAT 8' },
          { id: 'PSTAT 10' },
        ],
      },
      {
        label: 'Preparation for the Major',
        courses: [
          { id: 'CMPSC 8', alt: 'CMPSC W8' },
          { id: 'CMPSC 9', alt: 'CMPSC 16' },
        ],
      },
      {
        label: 'A — Core Probability & Statistics',
        courses: [
          { id: 'PSTAT 120A', alt: 'PSTAT W120A' },
          { id: 'PSTAT 120B' },
        ],
      },
      {
        label: 'B — Required Methods',
        courses: [
          { id: 'PSTAT 122' },
          { id: 'PSTAT 126' },
        ],
      },
      {
        label: 'C — PSTAT Electives (pick 6)',
        pick: 6,
        note: '24 units from elective PSTAT courses.',
        courses: [
          { id: 'PSTAT 100' },
          { id: 'PSTAT 105' },
          { id: 'PSTAT 115' },
          { id: 'PSTAT 120C' },
          { id: 'PSTAT 123' },
          { id: 'PSTAT 127' },
          { id: 'PSTAT 130' },
          { id: 'PSTAT 131' },
          { id: 'PSTAT 132' },
          { id: 'PSTAT 134' },
          { id: 'PSTAT 135' },
          { id: 'PSTAT 160A', alt: 'PSTAT W160A' },
          { id: 'PSTAT 160B' },
          { id: 'PSTAT 170' },
          { id: 'PSTAT 171' },
          { id: 'PSTAT 172A' },
          { id: 'PSTAT 172B' },
          { id: 'PSTAT 173' },
          { id: 'PSTAT 174', alt: 'PSTAT W174' },
          { id: 'PSTAT 175' },
          { id: 'PSTAT 176' },
          { id: 'PSTAT 183' },
          { id: 'PSTAT 197A' },
          { id: 'PSTAT 197B' },
          { id: 'PSTAT 197C' },
        ],
      },
      {
        label: 'D — Additional UD Electives (pick 2)',
        pick: 2,
        note: '8 units from other PSTAT or approved Math/Econ courses.',
        courses: [
          { id: 'MATH 104A' },
          { id: 'MATH 104B' },
          { id: 'MATH 104C' },
          { id: 'MATH 108A' },
          { id: 'MATH 108B' },
          { id: 'MATH 111A' },
          { id: 'MATH 111B' },
          { id: 'MATH 111C' },
          { id: 'MATH 117' },
          { id: 'MATH 118A' },
          { id: 'MATH 118B' },
          { id: 'MATH 118C' },
          { id: 'MATH 132A' },
          { id: 'MATH 132B' },
          { id: 'ECON 100B' },
          { id: 'ECON 101' },
          { id: 'ECON 134A' },
          { id: 'ECON 134B' },
        ],
      },
    ],
  },
  {
    id: 'econ_ba',
    name: 'Economics',
    degree: 'B.A.',
    year: '2025–2026',
    department: 'Economics',
    college: 'College of Letters and Science',
    preMajorGpa: 2.85,
    groups: [
      {
        label: 'Pre-Major',
        note: 'ECON 1, 2, and 10A with 2.85+ GPA. No grade below C.',
        courses: [
          { id: 'ECON 1' },
          { id: 'ECON 2' },
          { id: 'ECON 10A' },
        ],
      },
      {
        label: 'Preparation for the Major',
        note: 'ECON 5 and 10A must be taken at UCSB.',
        courses: [
          { id: 'ECON 5', alt: 'PSTAT 120A' },
          { id: 'MATH 2A', alt: 'MATH 3A' },
          { id: 'MATH 2B', alt: 'MATH 3B' },
        ],
      },
      {
        label: 'A — Required Core',
        courses: [
          { id: 'ECON 100B' },
        ],
      },
      {
        label: 'B — Required Core',
        courses: [
          { id: 'ECON 101' },
        ],
      },
      {
        label: 'C — Required Core',
        courses: [
          { id: 'ECON 140A' },
        ],
      },
      {
        label: 'D — UD Electives (pick 6)',
        pick: 6,
        note: '24 units from upper-division Economics electives.',
        courses: [
          { id: 'ECON 100C' },
          { id: 'ECON 106' },
          { id: 'ECON 107A' },
          { id: 'ECON 107B' },
          { id: 'ECON 112A' },
          { id: 'ECON 112B' },
          { id: 'ECON 113A' },
          { id: 'ECON 113B' },
          { id: 'ECON 114A' },
          { id: 'ECON 114B' },
          { id: 'ECON 115' },
          { id: 'ECON 116A' },
          { id: 'ECON 116B' },
          { id: 'ECON 116C' },
          { id: 'ECON 117A' },
          { id: 'ECON 120' },
          { id: 'ECON 122' },
          { id: 'ECON 127' },
          { id: 'ECON 130' },
          { id: 'ECON 133' },
          { id: 'ECON 134A' },
          { id: 'ECON 134B' },
          { id: 'ECON 134C' },
          { id: 'ECON 135' },
          { id: 'ECON 140B' },
          { id: 'ECON 140C' },
          { id: 'ECON 141' },
          { id: 'ECON 145' },
          { id: 'ECON 150A' },
          { id: 'ECON 151' },
          { id: 'ECON 152' },
          { id: 'ECON 153' },
          { id: 'ECON 154' },
          { id: 'ECON 155' },
          { id: 'ECON 156' },
          { id: 'ECON 157' },
          { id: 'ECON 160' },
          { id: 'ECON 164' },
          { id: 'ECON 170' },
          { id: 'ECON 171' },
          { id: 'ECON 174' },
          { id: 'ECON 176' },
          { id: 'ECON 177' },
          { id: 'ECON 180' },
          { id: 'ECON 181' },
          { id: 'ECON 183' },
          { id: 'ECON 184' },
          { id: 'ECON 187' },
          { id: 'ECON 196A' },
          { id: 'ECON 196B' },
          { id: 'ECON 199' },
        ],
      },
      {
        label: 'E — Additional UD Elective (pick 1)',
        pick: 1,
        note: 'From Area D or: ECON 118, 136A-C, 137A-B, 138A-B, 185.',
        courses: [
          { id: 'ECON 118' },
          { id: 'ECON 136A' },
          { id: 'ECON 136B' },
          { id: 'ECON 136C' },
          { id: 'ECON 137A' },
          { id: 'ECON 137B' },
          { id: 'ECON 138A' },
          { id: 'ECON 138B' },
          { id: 'ECON 185' },
        ],
      },
    ],
  },
]

export function getMajorById(id: string) {
  return majors.find((m) => m.id === id)
}
