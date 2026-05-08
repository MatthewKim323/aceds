# Workflow benchmark protocol (Baseline vs ACE)

**Purpose:** Quantify **time** and/or **click count** for an identical scheduling task — *optional* competition metric (W1).

## Task script (example)

1. Build a schedule for **four specified course_norms** in quarter **Q**.
2. Respect hard prefs: **no Friday afternoon**, units within **[min, max]** (match ACE prefs).
3. Prefer higher predicted grade signal where visible.

## Arms

| Arm | Steps |
|-----|--------|
| **Baseline** | Use GOLD (or PDF schedule lookup), RateMyProfessor, Nexus/static GPA sources, and a calendar tool separately — no ACE. |
| **ACE** | Complete the task only inside ACE `/schedule` + `/explorer` as needed. |

## Recording

- **Wall-clock time** from task start to “final schedule chosen.”
- **Click count** (or navigation steps) if feasible.

## Analysis

- Report **median** and **IQR** with **n ≥ 8** independent sessions (mixed arms or paired within-subject).
- Avoid unsupported **percent improvement** unless CI is computed.

## Ethics

- Inform participants of timing; no PII in raw logs.
