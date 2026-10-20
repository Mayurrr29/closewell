# Lead scoring rules

The lead score is a **transparent checklist of how much you know about a lead and whether it matches the criteria you set**. It is not a prediction of whether the lead will buy. The breakdown is stored with every lead and shown next to the score.

Implementation: `packages/shared/src/scoring.ts` (tested in `scoring.test.ts`). Recomputed whenever lead details or qualification answers change.

| Rule | Max | Points |
|---|---|---|
| Qualification answers | 40 | 40 × (weight of answered questions ÷ total weight of configured questions). 0 if no questions are configured. |
| Contact details | 15 | Email 10, phone 5 |
| Requirements described | 15 | 15 if the requirements text is at least 15 characters |
| Budget | 15 | 10 for a stated budget, +5 if it is at or above the configured minimum (or no minimum is set). A budget **below** the minimum scores 0. |
| Timeline | 15 | 10 for a stated timeline, +5 if it is within the configured maximum days (or no maximum is set). Timelines like "asap", "2 weeks", "3 months", "next month" are understood; unclear ones get 10. |

Total 0–100. A lead counts as "qualified" by score when it reaches the agent's **qualified threshold** (default 60). The dashboard's "Qualified leads" metric instead uses the pipeline stage (Qualified or later), because a stage is a decision a person or an approved action made.

Configure questions, weights (0–40), minimum budget, maximum timeline and threshold in **Sales agent → Qualification**.
