# R&D: visual revision of a master card, and "Ask AI" links

- **Date:** 2026-11-07. **Status:** research notes feeding `docs/spec-master-card.md` (Phase 23).
- **Update:** the design moved on after this was written. The self-marked "Revise" mode discussed below was dropped in favour of testing through the real study screen; the evidence still applies (retrieval drives the benefit, show the full answer, no strength colours while testing, expert-checked structure first). Where this text says Revise, read: a session over the real cards.
- **How it was done:** two research agents with web search (evidence; tools and links), plus a read of the master card code. Nothing was run against real assistants; every link below must be tested in a browser before it is relied on.
- **Honesty note:** the agents read abstracts and summaries, not full papers. Items marked unverified were not confirmed.

## 1. The question

Can a master card (a compact cheat-sheet of linked cards) be shown as a diagram, revised without becoming a read-only crutch, and fed by an AI that lives outside the app? What does the evidence and the tool landscape say, and what does it mean for Skola's design?

## 2. What the evidence says

| Finding | Strength | Source |
|---|---|---|
| Concept maps help learning overall (g about 0.58 across 142 effect sizes). Creating maps (g about 0.72) beats studying provided ones (about 0.43). | Strong (meta-analysis) | Schroeder, Nesbit, Anguiano & Adesope 2018, Educational Psychology Review ([SFU](https://summit.sfu.ca/item/17789)) |
| Retrieval practice beat building a concept map while looking at the text (67% vs 45% a week later). The benefit comes from retrieval, not the diagram. | Strong, one lab | Karpicke & Blunt 2011, Science ([supporting material](https://pcllab.github.io/downloads/2011/2011_Karpicke_Blunt_ScienceSupportingMaterial.pdf)) |
| A map built from memory worked about as well as free-recall writing; both beat studying with the text open. A diagram is fine as a retrieval format. | Moderate | Blunt & Karpicke 2014 ([summary](https://learningscientists.org/blog/2020/11/19-1)) |
| Learner-built diagrams are often poor; in one medical flow-diagram study expert-provided ones gave better one-month retention than learner-built. | Moderate | Kononowicz & Kenig 2013 ([listing](https://unpaywall.org/10.1515%2FBAMS-2013-0005)) |
| Crib sheets help exam scores but not learning; students may learn less when they expect to use one. | Weak to moderate, details unverified | Dickson & Miller 2005 and a crib-construction study |
| Learners are overconfident when grading themselves; seeing the full correct answer reduces it. Retrieval practice makes judgments more accurate than restudy. | Moderate | Rawson & Dunlosky 2007, Lipko et al. 2009 ([Van Loon & Roebers 2017](https://boris.unibe.ch/108582/8/Van%20Loon%20%26%20Roebers%202017%20ACP.pdf)) |
| Concept maps in medical education: positive but a small, uneven evidence base. | Moderate to weak | Daley & Torre 2010 ([PubMed](https://pubmed.ncbi.nlm.nih.gov/20374475/)); a 2025 review ([Springer](https://link.springer.com/article/10.1007/s10459-025-10437-4)) |
| Labelled-diagram or image-occlusion retrieval testing structure and relations; commit-before-reveal; confidence ratings. | **No direct evidence found** | inferred only |

### What it means for the design

1. **Revise is the learning; Open is a reference.** Only Revise may write reviews, and Open must not count as study. (Matches the spec.)
2. **Hide the boxes, keep the arrows,** so the learner recalls the entry with the structure as the cue. This is inference from the Blunt and Karpicke result, not tested for image occlusion.
3. **Show the full correct entry (and its card's answer on request) before the Got it / Missed mark.** The best-supported honesty aid. An optional "type it first" step is allowed but untested.
4. **Do not colour boxes by strength in Revise.** Colours cue the answer and inflate marks. Colours belong to Open only.
5. **Start from expert-checked structure.** The AI drafts the edges, the learner approves, and the learner can add or change links. Unguided learner diagrams are the weak case.
6. **Confidence-before-reveal is an experiment, not a feature.** Leave it out of Phase 23; record it under later ideas.

## 3. Prompt links ("Ask AI")

| Target | Format | Status |
|---|---|---|
| Claude desktop | `claude://claude.ai/new?q=<encoded>` | Official; about 14,000 characters then truncated; pre-fills, does not send ([Anthropic](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link)) |
| claude.ai web | `claude.ai/new?q=` | Undocumented; one source says it broke in October 2025 ([plugin docs](https://holdenhewett.github.io/starlight-llm-actions/getting-started/concepts/)), others say it works. Test it. |
| ChatGPT | `chatgpt.com/?q=` | Community-reported, no OpenAI doc; practical limit about 2,000 characters (one tool says 7,500) ([react-email PR](https://github.com/resend/react-email/pull/3404)) |
| Perplexity | `perplexity.ai/?q=` | Community-reported |
| Grok | `grok.com/?q=` | Community-reported |
| Gemini | none confirmed | Conflicting reports; treat as copy only |
| Microsoft Copilot, Mistral Le Chat | none found | Open the bare site; copy only |

**Design:** always copy first; use `claude://` for Claude desktop; use `?q=` only for ChatGPT, Perplexity, Grok and only when the encoded link is about 2,000 characters or less; everything else opens the bare site or copies only. The planned prompt (action plus ids only, no names or card text) is short enough for all of them. Because these formats are unofficial, targets are a user-editable synced list and the app must say "copied, paste it in" when it cannot prefill.

## 4. Diagram rendering options

| Option | Size (gzip, approximate) | Fit |
|---|---|---|
| **@xyflow/react + @dagrejs/dagre** | about 60 KB + 10 to 30 KB (xyflow measured, dagre estimated) | Keyboard focus and ARIA built in; masking a node is a custom node; fully offline; lazy chunk |
| Own SVG + dagre | smallest | Full control; accessibility must be built; most work |
| Mermaid | about 480 KB minified | Heavy; auto-layout; masking only by regenerating source; offline needs a precached chunk |
| elkjs | about 447 KB | Best layouts, far more than 30 boxes need |
| markmap | not measured | Trees only |

**Conclusion:** Mermaid, my first idea, is the wrong default (size, no per-node masking). Because the master stores **structure as data** (entry ids and edges) and not drawing text, the renderer is a swappable detail: start with `@xyflow/react` + dagre in a lazy chunk, keep the list view as the fallback, and fall back to own SVG if the size or offline check fails.

## 5. How other apps revise from a picture (from memory, unverified)

- Anki Image Occlusion: cover regions, one card per region. **Copy:** mask a node, reveal on tap.
- Obsidian canvas with spaced-repetition plugins: the canvas is a view over cards. **Copy:** the diagram is a view over the cards, not a separate store.
- RemNote: concept links give related prompts. **Copy:** show links as context in Open mode.
- Orbit: prompts sit where the idea appears. **Copy:** place the prompt in the structure.
- Mochi: no diagram revision mode known. Skip.

## 6. Fit with what Skola already does

- A master is sections of entries linked to cards (`MasterEntry { id, text, cardId? }`); suggested rating from the linked cards' FSRS state; the recall sweep, gap hunt and weak-spot drill exist; **nothing writes a review to a linked card from a master**. The recall sweep writes no card, and "study missed today" only moves due dates.
- Normal study does not write an answer to a Review-state card that is not yet due. The same rule must apply to marks from Revise, which is why a correct mark on a not-yet-due card is not written (a miss always is).
- No Mermaid, flow or layout library exists in the project today. The master graph view uses its own force layout, which is for notes, not for a labelled flow.

## 7. Open risks

- Self-marking can still inflate; the mitigations are showing the full answer and not showing colours. A later check could compare Revise marks with later normal reviews of the same cards.
- Prompt links are unofficial and may change; hence the user-editable list and the copy-first rule.
- No evidence yet that revising from a hidden diagram beats revising from cards. It is a design bet to measure (Phase 20 stats can show later recall of cards revised this way).

## 8. Later ideas (not in Phase 23)

- Confidence rating before reveal, with a calibration view.
- Learner-built diagrams as a graded step after expert-checked ones.
- PNG or SVG export of a sheet.
- Compare Revise marks with later card reviews to show how honest marking is.
