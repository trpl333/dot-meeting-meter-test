# Meeting Meter — Project Specification

## Purpose and authority

Meeting Meter is a simple static web application that makes the financial cost of a meeting easy to understand at a glance. This file is the authoritative requirements for the complete MVP.

## Technical scope

- Use HTML, CSS, and vanilla JavaScript only.
- No framework, database, authentication, external APIs, API keys, or paid services.
- No unnecessary dependencies, build tooling, or server-side components.
- The application must be deployable as a static site using GitHub Pages. Use relative asset paths so it works under a repository subpath.
- Work entirely in the browser. No user data needs to be transmitted or persisted.
- Support responsive desktop and mobile layouts.

## Inputs and defaults

Provide clearly labeled inputs with visible units:

| Input | Default | Valid values |
| --- | --- | --- |
| Number of attendees | 5 | Integer greater than or equal to 1 |
| Average loaded hourly cost per attendee | USD 100.00 | Finite number greater than or equal to 0 |
| Planned meeting duration | 30 minutes | Finite number greater than or equal to 0; fractional minutes are allowed |

Loaded hourly cost means the estimated hourly cost of one attendee, including salary and overhead. Include a short explanation near the field.

Reject or safely handle blank, nonnumeric, negative, nonfinite, and out-of-range values. Fractional attendee counts are invalid. Do not silently turn an invalid entry into a plausible estimate. Values whose calculated totals overflow must also be treated as invalid.

Use understandable inline validation. Invalid drafts must never produce `NaN`, `Infinity`, negative currency, or a broken timer. Retain the last valid applied values for calculations while a field is invalid, and clearly say that displayed estimates still use those last valid values. Disable Start/resume until all fields are valid. An already running timer may continue using the last valid rate; Pause and Reset must remain usable.

## Outputs and formulas

Show these prominent, clearly labeled outputs:

1. Projected total meeting cost
2. Cost per minute for the whole meeting
3. Elapsed meeting time
4. Live running meeting cost

For the currently applied valid inputs:

- `costPerMinute = attendeeCount × hourlyCostPerAttendee / 60`
- `projectedTotal = costPerMinute × plannedDurationMinutes`
- With an unchanged rate, `liveCost = costPerMinute × activeElapsedSeconds / 60`

Format all currency as US dollars with a dollar sign, thousands separators where needed, and exactly two decimal places. Preserve full precision internally and round only for display.

Display elapsed time in an understandable hours/minutes/seconds format, starting at `00:00:00`. Live cost starts at `$0.00`. Clearly distinguish projected cost from accrued live cost.

## Timer controls and state

Provide visible Start, Pause, and Reset controls and an understandable idle/running/paused status.

- **Start from idle:** begin counting elapsed time and accruing live cost.
- **Pause:** freeze elapsed time and live cost immediately.
- **Start from paused:** resume from the accumulated elapsed time and cost. Time spent paused must not count.
- **Reset from any state:** stop the timer, clear elapsed time and live cost to zero, and return to idle. Preserve input values and their projected calculations.
- Repeated Start clicks must not create multiple timers or accelerate accrual. Pause while idle/paused and repeated Reset must be safe.
- Planned duration is an estimate, not a countdown limit. Passing it must not stop or reset the live timer.
- Use timestamp differences with a monotonic elapsed-time source rather than counting interval callbacks. Delayed callbacks or background-tab throttling must not lose elapsed running time; refresh the display correctly when execution resumes.
- Update the visible elapsed time and live cost regularly while running, at least once per second when the page is active.
- A page reload starts a new idle session with the documented defaults. Persistence is outside the MVP.

## Input changes during a session

Inputs remain editable. Apply valid changes immediately to projected total and cost per minute.

Live cost represents cost already accrued and must never be retroactively repriced:

- On a valid attendee-count or hourly-cost change while running, first accrue the elapsed interval using the old rate, then use the new rate for future running time.
- While paused, input changes update estimates but do not change elapsed time or accrued live cost. Resuming uses the latest valid rate.
- Changing planned duration affects projected total only. It never changes the timer, cost per minute, or accrued live cost.
- For changing rates, calculate `liveCost = sum(ratePerMinuteForInterval × activeSecondsForInterval / 60)`. A running total is sufficient; no history feature is required.
- Include a concise hint explaining that rate changes affect future live cost only and that paused time is excluded.

## Design and usability

- Simple, professional presentation with clear visual hierarchy and useful spacing.
- Inputs, key figures, and controls must be understandable at a glance.
- Responsive layout without horizontal overflow at a 320 CSS-pixel mobile viewport or a typical desktop viewport.
- Controls must remain usable by touch and keyboard, with associated input labels, visible focus states, readable text, and adequate contrast.
- Use a system-font stack and local assets if any. No external fonts, analytics, or decorative dependencies are needed.
- Do not add accounts, meeting history, integrations, exports, or other unrelated features.

## Acceptance criteria and verification

The implementation is complete only when all of the following are verified:

1. **Initial state:** defaults are 5 attendees, USD 100/hour each, and 30 minutes. Projected total is `$250.00`, cost per minute is `$8.33`, elapsed time is `00:00:00`, and live cost is `$0.00`.
2. **Known calculation:** 2 attendees at USD 120/hour each for 30 minutes produces `$120.00` projected total and `$4.00` per minute.
3. **Start:** with the known calculation above, 15 seconds of active running time costs `$1.00`; 60 active seconds costs `$4.00`. Allow for the visible refresh interval when observing the UI.
4. **Pause/resume:** pausing freezes both outputs for the entire pause. Resuming continues from the saved elapsed time and cost without including paused time.
5. **Reset:** from either running or paused, Reset stops accrual and returns elapsed time and live cost to zero. Waiting afterward does not restart accrual, and inputs remain unchanged.
6. **Repeated controls:** rapid/repeated Start, Pause, and Reset interactions produce no duplicate timers, jumps, negative values, or exceptions.
7. **Estimate changes:** valid input edits immediately update estimates with the formulas above. Changing only planned duration does not change cost per minute or live accrual.
8. **Rate changes:** accrue 30 active seconds at `$4.00`/minute, then 30 active seconds at `$2.00`/minute. Elapsed time is one minute and live cost is `$3.00`. Changing the rate during a pause leaves the accrued cost frozen until resumed.
9. **Validation:** test blank, nonnumeric, negative, nonfinite/overflow values, and fractional attendee counts. Show clear errors, preserve a safe last-valid calculation, and disable Start/resume until corrected. Pause and Reset still work.
10. **Zero values:** zero hourly cost is valid and gives zero projected/live cost; zero planned duration is valid and gives zero projected cost without preventing the live timer from running.
11. **Timing reliability:** a running meeting continues past planned duration. Backgrounding and returning to the tab preserves timestamp-based elapsed time and cost without callback-count drift.
12. **Formatting and layout:** USD amounts consistently show two decimals and separators; labels and controls work with keyboard and touch; desktop and 320-pixel mobile layouts remain readable without horizontal overflow.
13. **Static compatibility:** the app runs without a server-side service or build step and works from a GitHub Pages-style repository subpath with no missing assets, console errors, or external API/dependency requests.

Use manual checks and/or small dependency-free tests as appropriate. Record what was verified and any limitations in the implementation pull request. Make the site ready for GitHub Pages; actually enabling hosting or deploying it is not required by this MVP.
