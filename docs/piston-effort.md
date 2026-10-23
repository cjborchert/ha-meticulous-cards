# Piston effort card (`meticulous-effort-card`)

Shows how much current the piston motor needs over time. Rising current means more friction, and
it drops back after greasing or descaling. The card also says whether maintenance is coming up,
forecasts when it will be due, and lets you log maintenance.

```yaml
type: custom:meticulous-effort-card
calendar: calendar.home_maintenance   # optional: "Log maintenance" adds events here (else the machine's own log)
stroke: 76                            # optional: piston stroke in mm, for the lower's speed
```

## Moves

| Button | Byline | What it is |
|---|---|---|
| **Lower** | Manual lower from idle | The machine goes from *Idle* straight to *Purge*, e.g. when you lower the piston while cleaning. One value per lower. |
| **Retraction** | Post-shot retraction, every shot | The full-power retraction right after every shot (*Piston After-Shot* sensors). One value per shot, with history imported from the machine. |

The purge after a shot (*Click to Purge* → *Purge*) is **not** used. It pushes water through the
puck and shower screen, so its effort depends on the shot.

Earlier versions also showed the manual raise and the pre-shot retract. The raise was removed: it is
noisier than the lower and takes much more current on a cold, rested machine (see *Cold starts*
below). The pre-shot retract always runs at full drive, so its power reading carries no information.

## Measures

| Button | What it is |
|---|---|
| **Current** (A) | Average motor current during the move. **The friction indicator**: the machine drives the piston at a fixed speed (manual moves) or a fixed full drive (retraction), so extra friction shows up as extra current. |
| **Speed** (mm/s) | Retraction: median speed of the steady part (it drops slightly as friction rises). Lower: stroke ÷ duration (the machine holds this speed, so it barely changes). |

Time ranges: 15 days, 30 days, 90 days, 6 months or 1 year.

The selected move is shown in white, Current in blue and Speed in lavender. Yellow and cyan are kept for the
grease and descale markers, as on the maintenance card, and green/amber/orange for status.

## Chart

- **D** (cyan) and **G** (yellow) dashed lines mark logged descales and greases. When both were done
  on the same day, the line alternates both colours and carries both letters.
- A dashed white **trend line** per maintenance cycle, labelled with its change per month (see
  *Smoothing and the summary numbers*).
- **Soon** / **Due** dashed lines: the maintenance levels, when the chart shows the current of the
  move the forecast uses.
- The key under the numbers lists only what is on the chart.
- Tap or drag the chart to read any point.

## Messages

| On the chart | Meaning |
|---|---|
| **Machine not found** | No `sensor.<prefix>_state`. Set `prefix:` in the card to your machine's entity prefix (default `meticulous_espresso`). |
| **No retraction data** / **No lower data** | The integration doesn't provide the *Piston After-Shot* / *Piston Lower* sensors (yet). |
| **Nothing in this range** | The sensor exists but has no measurements in the chosen period. Pick a longer range. |
| **No measurements yet** | Not a single measurement in the last year, e.g. right after setup. |
| **Loading…** | Waiting for Home Assistant's history (it retries on its own, e.g. after a tablet wakes up). |

At the bottom, **No forecast** means the move chosen for the forecast has no sensor; pick the other
one in the gear menu. The forecast defaults to the retraction when its sensor exists, otherwise
the lower.

## Maintenance levels and forecast

The bottom of the card shows the **maintenance status**, based on the current of the move chosen in
the gear menu (**Predict from: Lower / Retraction**):

| Status | When |
|---|---|
| **OK** (green) | below the *Maintenance soon* level |
| **Maintenance soon** (amber) | at or above the *Maintenance soon* level: plan to grease/descale |
| **Maintenance due** (orange) | at or above the *Maintenance due* level: time to grease/descale |
| **Maintained** (date) | maintenance was logged and there are not yet 3 new measurements |

- **Levels** are set with the gear (− / + in 0.01 A steps). They are stored per machine (shared by
  every Home Assistant user, see *Where settings are kept*) and per move. Until you set them, the card suggests levels relative to the level right after the
  last maintenance: **Retraction +30 % / +50 %** (it rose about 55 % over a full maintenance cycle in 2026),
  **Lower +10 % / +15 %** (it rises about a quarter as fast). These suggestions come from one
  machine, so adjust them once you've seen a full cycle on yours.
- The **current level** is the 7-day median for the retraction and the median of the last 3 lowers.
- The **forecast** ("due in ~N days · ~M shots") extends the trend since the last maintenance (a
  least-squares line through the individual points, at least 5 points over at least 3 days) to the
  *Maintenance due* level. Shots per day come from the shot counter over the last 30 days. If the trend
  isn't rising, the card says so instead of guessing.
- When the chart shows the current of the move used for the forecast, the two levels are drawn as
  dashed lines (**Soon** amber, **Due** orange). Levels you set are drawn even before there are
  enough measurements for a status; suggested levels appear once there are.
- The gear menu shows the level now and right after the last maintenance, and whether the levels
  are suggested or your own.

## Logging maintenance

**Log maintenance** asks *What did you do today?* with **Descaled** and **Greased** (pick one or both),
then adds an all-day event per choice to the maintenance calendar: *Meticulous: Descale* and/or
*Meticulous: Grease piston*, with the current shot count. These are the same events the maintenance
card uses, so its counters reset too. Without a calendar, the card keeps the log with the machine's
settings. The new event becomes the **D**/**G** marker on the chart and starts a new maintenance cycle
for *Change*, *Trend* and the forecast. Without a calendar the dialog says *Saved with this
machine's settings*, with a calendar it names the calendar it adds to.

The new cycle starts at the moment you logged it: the event description records the time
(*Logged 2026-10-22 21:15*), so shots earlier that day stay in the old cycle. Events you add or move
by hand count from midday on their date.

## How the machine moves the piston (what the data shows)

- Every manual raise and lower takes almost exactly the same time: **12.7–13.1 s** in October 2026.
  The machine drives the piston at a fixed speed, so extra friction shows up as **more current**,
  not as a slower move. Average drive level sits around 62–65 % and hardly moves.
- The post-shot retraction runs at full drive (−100 %), so extra friction shows up as more current
  and a slightly lower speed.

## Cold starts (why the manual raise was dropped)

A manual raise took clearly more current when the machine was **cold and had been standing still**
(1.46–1.54 A at 22–24 °C after 45 min to 10 h of rest, against 1.22–1.33 A normally). A raise one
minute after another at the same cold temperature was normal (1.28 A), and so was a raise after
46 minutes at 30 °C. A plausible cause is cold seals that settle while standing and need extra
breakaway force on the first move. The manual lower always follows a raise during cleaning, so it
never sees this effect, which is one reason it is the cleaner manual measure.

## Drive level and how visible friction is (working hypothesis)

The force the motor delivers has to cover the piston's normal load plus seal friction. At a high
drive level friction is a small part of the total and a slow rise hides in the noise; at a lower
drive level the same rise stands out more; at a very low drive level the drive force can drop to the
friction force and the piston would stop. Not confirmed against the firmware.

## Smoothing and the summary numbers

- **Line**: a running median, so single odd measurements don't pull it around. Retraction: the
  median of all shots within ±3.5 days (a 7-day median), over small dots for the individual shots,
  broken over gaps of more than a week. Lower: the median of 3 consecutive measurements.
- **Latest** / **7-day median**: the latest lower, or the current 7-day median of the retraction.
  Tap or drag the chart to inspect any point.
- **Maintenance cycles**: the stretches between logged descales and greases. *Change*, *Trend* and
  the dashed trend lines are worked out per cycle over the whole cycle, not over the visible part,
  so they stay the same whichever time range you pick. The caption under *Change* and *Trend* says
  which cycle they describe (*Since maintenance 22 Oct*, or *Over the last 60 days*).
- **Change**: the current level against the level right after the last descale or grease
  (retraction: 7-day medians, the first week against the last week; lower: the median of the first
  three against the last three), the same levels the forecast uses. Green below 5 %, amber 5–10 %,
  orange above 10 % (for Speed, a drop counts as worse). Shows — until there are 3 measurements
  since the maintenance.
- **Trend**: least-squares slope through the cycle's individual measurements, as % per month of the
  level right after the maintenance. Needs at least 5 measurements over at least 3 days.
- **Trend lines**: one dashed line per cycle, labelled with its % per month when there is room.
  Before the first logged maintenance there is no line: its start is unknown and it may hide a
  cleaning that wasn't logged (for example a drop in the data with no event in the calendar). Logging that date in the calendar
  gives it a line too.
- Without any logged maintenance in the last year, *Change* and *Trend* cover the last 60 days, the
  same window the forecast uses.
- Shot count was also tested as the x-axis instead of time. It fitted no better, and over a 25-day
  break without shots the retraction current still rose from 1.05 to 1.29 A. Friction rises with
  time and standing still as well as with use, so the card keeps time on the axis.

## Which measure to watch (comparison, 15–22 October 2026)

Over the eight days with manual raise and lower data, each measure was fitted with a straight line.
The leftover scatter around that line is the noise:

| Measure | Points | Rise | Scatter around the trend | Days to see a change of 2× the scatter |
|---|---|---|---|---|
| **Lower**, current | 15 | +13 mA/day | 19 mA | **about 3** |
| **Raise** (warm, cold starts left out), current | 12 | +8 mA/day | 27 mA | about 7 |
| **Retraction**, current, single shots | 19 | +25 mA/day | 200 mA | about 16 |
| **Retraction**, current, daily median | 8 | +19 mA/day | 170 mA | about 19 |

- **Lower is currently the cleanest indicator.** It always runs right after a raise during cleaning,
  so the piston has just moved and is warm. That makes every lower a similar, repeatable test. It is
  also the only measured move in the pushing direction.
- **Raise adds little on top of Lower.** It is noisier, sensitive to cold starts and rises more
  slowly, so it was removed from the card.
- **Retraction is the only measure without any manual action, and the only one with history.** It
  shows maintenance most clearly (steps of 0.27–0.50 A in May and August). But the scatter between
  shots grows as friction rises: about 15 mA shortly after maintenance (May–June), about 80 mA (median
  deviation) since mid-September. The first shot of a session tends to read lower than the second,
  and lower when the bottom of the brew chamber is warmer. A temperature correction was tested and
  did not reduce the scatter reliably, so the card relies on the 7-day median instead. The growing
  scatter is itself a sign of uneven lubrication.

In short: use **Lower** for a quick, precise reading after cleaning, and **Retraction** for the long
view and for users who rarely clean manually.

## Data sources

- Recent measurements come from the recorder history: one value per move, exactly when it happened.
- Older ones (beyond the recorder's retention, 10 days by default) come from long-term statistics,
  which only keep hourly means. Cold-start detection uses state history, so it only works for moves
  still in recent history.
- Identical repeated values within 6 hours are treated as one, because restarts can re-publish the
  same value.
- If history can't be loaded (e.g. a wall tablet just woke up), the card keeps what it had and
  retries after 5 s, 10 s, 20 s… *No measurements yet* only appears when the history really is empty.

## Retraction: a measure for every shot

Manual raises and lowers only happen when you clean the machine. The machine's own shot history
(`/api/v1/history` on the machine, about 10 samples a second) also records motor current, drive
level, speed and piston position during every shot. This was analysed for all 506 shots from
January to October 2026 to find a measure that works for everyone.

**Candidate 1: low-drive moves at 0 bar (below 70 %).** These are mostly the slow fill and pre-brew
moves at the start of a shot (0.5–4 mm/s, about 10–45 % drive). Even after correcting for speed
(fitting current = a + b·speed per shot), the result barely responds to maintenance: at most
about 2× the shot-to-shot noise, with the sign changing between events. At these moves the motor
also pushes water into the basket and puck, and that load varies with the profile. **Not usable.**

**Candidate 2: the retract after every shot.** As soon as the shot ends, the machine raises the
piston at **full drive (−100 %)** with the pressure at 0 bar. Because the drive level is always the
same, no speed recalibration is needed: more friction simply means more current and a lower
speed, along the motor's own line (speed ≈ 11.2 − 1.08 × current, from the data).

Per shot:

1. take the samples after the shot where pressure < 0.1 bar, drive ≤ −99 % and speed is steady
   (faster than 8 mm/s upwards);
2. keep only piston positions 35–55 mm. Almost every shot record covers this window, and current
   depends a little on position;
3. the shot's value is the **median current** of those samples (median speed as a cross-check);
4. plot a 7-day rolling median to smooth shot-to-shot scatter.

Results:

| | Current |
|---|---|
| Same-day shot-to-shot noise | 0.035 A |
| Step at maintenance on 10 May | 1.49 → 0.99 A (14× the noise) |
| Step at maintenance on 31 Aug | 1.32 → 1.05 A (8× the noise) |
| After 3+ weeks unused (Jul–Aug) | jumped from about 1.1 to 1.3 A |
| Now (late October) | about 1.6 A and rising, the highest on record |

Right after greasing, the current is flat along the whole stroke (about 1.0 A everywhere). Now it
varies along the stroke and between shots, which also fits uneven lubrication. The dates of the
two steps come from the data (shots just before and after).

The retract after a shot might also include some suction through the puck, so this is not *pure*
friction. It still tracks maintenance far better than any other measure in the data. It also reacts more
strongly than the manual raise: from 15–16 to 19–22 October the retract current rose from 1.50 to
1.62 A (+8 %), the warm manual raises about 4 %. Since the maintenance on 31 August it has risen
from about 1.0 to 1.6 A (+60 %).

**In the card:** the **Retraction** button shows two measures, **Current** (A) and **Speed** (mm/s).
With many points (one per shot), the card draws small dots plus a 7-day running median line, broken
over gaps of more than a week.

**Sensors:** the integration publishes the result once per shot as *Piston After-Shot Current* and
*Piston After-Shot Speed* (`after_shot.py`). It uses the same filter on the live Socket.IO stream,
with the pressure taken from the status events.

**History:** the first time the integration starts with these sensors, it reads every shot stored on
the machine (`/api/v1/history`, three days of shots per request, one request at a time). It
summarises each shot the same way and imports the results into Home Assistant's long-term
statistics, one hourly row per hour with shots (`history_import.py`). The card shows the whole history
straight away instead of starting empty. The import runs once in the background; the service
`meticulous_espresso.import_shot_history` re-runs it, and repeating it is safe.

Older points come from long-term statistics, so when you pull two shots within the same hour they
show as one point (their mean).
