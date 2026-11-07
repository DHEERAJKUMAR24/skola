# Skola — Feature Inspiration Shortlist

- **Status:** PARKED — 2026-11-07. Reviewed; not being implemented now. Revisit after Phases 16 to 24.
- **Source:** Awesome FSRS catalogue (GitHub). Feature descriptions from catalogue, not hands-on testing.

---

## Legend

- **Already have** — Feature exists in Skola.
- **Take inspiration** — Worth studying and potentially implementing.
- **Park** — Not a current priority.

---

## Recommended priorities (extracted for future planning)

| Priority | Feature | Inspiration source |
|---|---|---|
| P0 | Programmable / interactive cards | Etude |
| P0 | AI answer grading and feedback | Etude, Loudwalk |
| P0 | Subskill-level evaluation and independent scheduling per subskill | LinGoat |
| P0 | Agent-driven card writing and quality checks | Armin |
| P1 | Incremental reading — import article, read progressively, schedule next section | ZKMemo, Foliole |
| P1 | Source-grounded AI assessments | MySummaries, BiliMind |
| P1 | Zettelkasten atomic-concept linking with backlinks | ZKMemo |
| P1 | Mnemonics and memory aids generated alongside cards | Flipnem |
| P1 | Code execution and test-case-based grading | MemPro |
| P2 | Voice-first recall — read question aloud, accept spoken answer | Loudwalk |
| P2 | Lecture audio → flashcards pipeline | Discito |
| P2 | Image occlusion | Discito (Skola already has this) |

**Strongest recommendation:** Study Etude + LinGoat + MySummaries first. Together they address interactive cards, subskill measurement, and assessment-to-remediation loops.

**Core architectural principle:** Merge related concepts for presentation (fewer cards), but retain independently measurable subskills underneath. One weak sub-answer should not mask a knowledge gap, nor should one partially correct answer inflate competence.

---

## The bigger opportunity: Skola learning engine

```
1. Acquire knowledge
   Documents · Articles · Videos · Code · Lectures

2. Understand and organize
   Knowledge graph · Zettelkasten · Prerequisites · Incremental reading

3. Compress knowledge
   Deduplication · Concept merging · Compact retrieval units · Mnemonics

4A. Retain                    4B. Apply
    FSRS · Active recall           Code · Challenges · Examinations · Oral explanations
    Adaptive reviews

5. Evaluate and adapt
   AI grading · Subskill diagnosis · Gap detection · Adaptive card creation

   ↺ Continuous learning loop
```

---

## Per-tool profiles

### 1. Armin — Top candidate
Open-source · MIT · Desktop · FSRS · MCP

| Feature | Decision |
|---|---|
| Hierarchical knowledge and prerequisite relationships | Already have (hierarchy + graph view) |
| AI-assisted card creation through local MCP | Already have |
| Agent card-writing skill | **Take inspiration** — study its approach to concise, non-duplicated cards |
| FSRS scheduling | Already have |

### 2. Etude — Top candidate
Open-source · MIT · Local SQLite · FSRS-6

| Feature | Decision |
|---|---|
| Programmable flashcards — cards as interactive mini-applications | **Take inspiration** |
| AI grading of free-text, code, and open-ended answers | **Take inspiration** |
| CLI with JSON output for AI agents | Park |
| Anki import and exam deadlines | Park |

**Priority:** Programmable cards + AI-based answer evaluation.

### 3. Flipnem — Worth studying
Web · MCP · FSRS · Anki-compatible · PWA

| Feature | Decision |
|---|---|
| AI agent access to collections | Already have |
| Quizzing and deck management through MCP | **Take inspiration** — richer agent-driven learning workflows |
| Mnemonics and memory reinforcement | **Take inspiration** |
| Deck encryption | Park |
| PWA support | Already have |

### 4. ZKMemo — Top candidate
Offline-first · FSRS-6 · AI · Knowledge graph

| Feature | Decision |
|---|---|
| Tree-structured knowledge management | Already have |
| Incremental reading | **Take inspiration** |
| Zettelkasten linking — atomic concepts, backlinks, references | **Take inspiration** |
| AI-assisted knowledge organization | **Take inspiration** |

### 5. MySummaries — High priority to study
AI learning · Study boards · FSRS-6 · Written and oral assessments

| Feature | Decision |
|---|---|
| AI-generated study boards from PDFs, slides, notes | **Take inspiration** — structured knowledge before cards |
| Written timed examinations | **Take inspiration** |
| Spoken oral examiner with follow-up questions | **Take inspiration** |
| Missed-question recovery → new/updated retrieval units | **Take inspiration** |
| Cross-subject review queues | **Take inspiration** |

**Why study it:** Connects learning, testing, and remediation into one feedback loop.

### 6. MemPro — High priority to study
Programming education · Code exercises · FSRS-6 · MCP

| Feature | Decision |
|---|---|
| Programming concept cards | Already have |
| Interactive code exercises (write code inside a learning exercise) | **Take inspiration** |
| Automated test-based grading | **Take inspiration** |
| AI-assisted custom topics through MCP | **Take inspiration** |

**Why study it:** Programming education — remembering a concept ≠ being able to implement it.

### 7. Loudwalk — Worth studying
Voice-first learning · Spoken recall · FSRS-6

| Feature | Decision |
|---|---|
| Read questions aloud | **Take inspiration** |
| Speech recognition for answers | **Take inspiration** |
| Evaluate spoken answers against expected concepts | **Take inspiration** |
| FSRS ratings from evaluated recall quality | **Take inspiration** |

**Why study it:** Hands-free active recall and explanation practice.

### 8. Foliole — High priority to study
Open-source · Local-first · Incremental reading · FSRS

| Feature | Decision |
|---|---|
| Incremental reading — progressive import and scheduling | **Take inspiration** |
| Highlight extraction → knowledge units | **Take inspiration** |
| Reading prioritization by importance and progress | **Take inspiration** |
| FSRS-integrated reading workflow | **Take inspiration** |

**Why study it:** Skola becomes a system managing both knowledge acquisition and retention.

### 9. Discito — Worth studying
iOS · FSRS-6 · On-device AI · Audio learning

| Feature | Decision |
|---|---|
| AI card generation on-device | **Take inspiration** |
| Lecture audio → flashcards | **Take inspiration** |
| Image occlusion | Take inspiration (Skola already has this) |
| Anki import/export | Park |

### 10. BiliMind Desktop — Worth studying
Open-source · Desktop · AI-generated courses · FSRS

| Feature | Decision |
|---|---|
| Convert documents into structured courses | **Take inspiration** |
| Source-grounded quizzes | **Take inspiration** |
| Exam-oriented study plans | **Take inspiration** |
| Calendar export | Park |

### 11. LinGoat — Very interesting concept
AI learning · Fine-grained evaluation · FSRS-6

| Feature | Decision |
|---|---|
| Multiple concepts evaluated within one answer | **Take inspiration** |
| Independent FSRS scheduling per subskill | **Take inspiration** |
| Combine multiple due concepts into one exercise | **Take inspiration** |

**Why study it:** Keeps card counts low without hiding individual weaknesses. Directly addresses Skola's core design goal.
