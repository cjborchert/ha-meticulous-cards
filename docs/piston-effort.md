# Piston effort card (`meticulous-effort-card`)

The piston is sealed against the brew chamber wall. As the seal's lubrication wears off and scale
builds up, it takes more force to move the piston. The card shows that force as **motor current**
over time: it creeps up between maintenance and drops back after greasing or descaling. The card
also tells you when maintenance is coming up, forecasts when it will be due, and lets you log it.

The card measures **total** friction: lack of grease, scale and coffee residue in the cylinder all
add to it, and the card can't tell which one it is. It is a tool for setting your own maintenance
triggers. When in doubt, follow Meticulous's
[maintenance and repair recommendations](https://meticuloushome.com/pages/maintenance-and-repairs).

```yaml
type: custom:meticulous-effort-card
calendar: calendar.home_maintenance   # optional: "Log maintenance" adds events here (else the machine's own log)
stroke: 76                            # optional: piston stroke in mm, for the lower's speed
```

The card needs the integration's piston sensors (*Piston Lower …* and *Piston After-Shot …*). The
numbers quoted below as examples come from the machine the card was developed on (see
[Background](#background-the-analysis-behind-the-card)). Every machine, seal and grease will give
different absolute values, so judge your machine by its own trend, not by these numbers.

## Using the card

### Moves

| Button | Byline | What it is |
|---|---|---|
| **Retraction** | Post-shot retraction, every shot | The full-power retraction right after every shot. One value per shot, with no action from you. Past shots are imported from the machine when the sensors are first set up. |
| **Lower** | Manual lower from idle | Lowering the piston from idle, e.g. while cleaning. One value per lower, so only available if you lower the piston by hand. |

The purge after a shot is **not** used: it pushes water through the puck and shower screen, so its
effort depends on the shot. The manual raise isn't used either (see
[Cold starts](#cold-starts-why-the-manual-raise-isnt-used)).

### Measures

| Button | What it is |
|---|---|
| **Current** (A) | Motor current during the move. **The friction indicator**: extra friction shows up as extra current (see [How the machine moves the piston](#how-the-machine-moves-the-piston)). |
| **Speed** (mm/s) | Retraction: the speed of its steady part, which drops slightly as friction rises. Lower: stroke ÷ duration. The machine holds this speed, so it barely changes. |

Time ranges: 15 days, 30 days, 90 days, 6 months or 1 year. The selected move is shown in white,
Current in blue and Speed in lavender. Yellow and cyan are kept for the grease and descale markers
(as on the maintenance card), and green/amber/orange for status.

### Chart

- **D** (cyan) and **G** (yellow) dashed lines mark logged descales and greases. When both were done
  on the same day, the line alternates both colours and carries both letters.
- A dashed white **trend line** per maintenance cycle, labelled with its change per month.
- **Soon** / **Due** dashed lines: your maintenance levels, when the chart shows the current of the
  move the forecast uses.
- The key under the numbers lists only what is on the chart.
- Tap or drag the chart to read any point.

### Summary numbers

- **7-day median** (retraction) or **Latest** (lower): the current level. The tapped point when you
  tap the chart.
- **Change**: the level now against the level right after the last descale or grease.
  - Green below 5 %, amber 5–10 %, orange above 10 %. For Speed, a drop counts as worse.
  - Shows — until there are 3 measurements since the maintenance.
- **Trend**: how fast the current is rising, as % per month of the level right after the last
  maintenance. Needs at least 5 measurements over at least 3 days.
- The caption under *Change* and *Trend* says which period they describe, for example *Since
  maintenance 22 Oct*. Without any logged maintenance in the last year they cover the last 60 days.

*Change*, *Trend* and the trend lines are worked out per **maintenance cycle** (the stretch between
two logged descales or greases) over the whole cycle, so they don't change when you pick another
time range. The stretch before your first logged maintenance gets no trend line, because its start
is unknown and it may hide a cleaning that wasn't logged. Adding that date to the calendar gives it
a line too.

### Maintenance levels and forecast

The bottom of the card shows the **maintenance status**, based on the current of the move chosen in
the gear menu (**Predict from: Retraction / Lower**):

| Status | When |
|---|---|
| **OK** (green) | below your *Maintenance soon* level |
| **Maintenance soon** (amber) | at or above the *Maintenance soon* level: plan to grease/descale |
| **Maintenance due** (orange) | at or above the *Maintenance due* level: time to grease/descale |
| **Maintained** (date) | maintenance was logged and there are not yet 3 new measurements |

- **Setting levels:** use the gear menu (− / + in 0.01 A steps). The menu shows the level now and
  right after the last maintenance, to help you choose.
- **Suggested levels:** until you set your own, the card suggests levels relative to the level
  right after the last maintenance:

  | Move | Soon | Due |
  |---|---|---|
  | Retraction | +30 % | +50 % |
  | Lower | +10 % | +15 % |

  On the development machine the retraction rose about 55 % over a full cycle and the lower about a
  quarter as fast. Adjust the levels once you've seen a full cycle on yours, for example to the
  level where the piston started to feel or sound rough.
- **Shared settings:** levels are kept per machine and per move, and shared by every Home Assistant
  user. Only admins can change them.
- **The level used:** the 7-day median for the retraction, or the median of the last 3 lowers.
- **Forecast** ("due in ~N days · ~M shots"):
  - It extends the trend since the last maintenance to the *Due* level.
  - Shots per day come from the shot counter over the last 30 days.
  - If the trend isn't rising, the card says so instead of guessing.

### Logging maintenance

**Log maintenance** asks *What did you do today?* Pick **Descaled**, **Greased** or both.

- **With a calendar:** it adds an all-day event per choice (*Meticulous: Descale* /
  *Meticulous: Grease piston*) with the current shot count. These are the same events the
  maintenance card uses, so its counters reset too.
- **Without a calendar:** the log is kept with the machine's settings. Only admins can do this.
- The entry becomes the **D**/**G** marker on the chart and starts a new maintenance cycle.

The new cycle starts at the moment you log it: the event description records the time, so shots
earlier that day still count towards the old cycle. Events you add or move by hand count from midday
on their date.

### Messages

| On the chart | Meaning |
|---|---|
| **Machine not found** | No `sensor.<prefix>_state`. Set `prefix:` in the card to your machine's entity prefix (default `meticulous_espresso`). |
| **No retraction data** / **No lower data** | The integration doesn't provide the *Piston After-Shot* / *Piston Lower* sensors (yet). |
| **Nothing in this range** | The sensor exists but has no measurements in the chosen period. Pick a longer range. |
| **No measurements yet** | Not a single measurement in the last year, e.g. right after setup. |
| **Loading…** | Waiting for Home Assistant's history. It retries on its own, e.g. after a tablet wakes up. |

At the bottom, **No forecast** means the move chosen for the forecast has no sensor. Pick the other
one in the gear menu. The forecast defaults to the retraction when its sensor exists, otherwise
the lower.

### Which move to use

- **Retraction** works for everyone and needs no manual action. It shows maintenance very clearly
  and has history from day one. Single shots scatter, more so as friction rises, so it is a
  long-term view: watch the 7-day median and the trend.
- **Lower** is the more precise single reading. It only exists if you lower the piston by hand
  (for example while cleaning), and it rises more slowly than the retraction.

## How it works

### How the machine moves the piston

- **Manual lowers and raises:** the machine moves the piston at a **fixed speed**. One stroke takes
  about 13 s every time, at a drive level of about 60–65 %. It adjusts the drive to hold that speed,
  so extra friction shows up as **more current**, not as a slower move.
- **The retraction right after a shot:** this runs at **full drive** (−100 %) once the pressure is
  back at 0 bar. With the drive fixed, extra friction shows up as more current and a slightly lower
  speed.

### Drive level and friction

The motor's force has to overcome the seal friction plus whatever else the piston is pushing or
pulling. This has three effects:

- **At high drive**, friction is a small part of the total, so a slow rise in friction is a small
  change in current.
- **At lower drive**, the same rise in friction is a larger share of the load.
- **At very low drive**, the motor's force drops to the friction force and the piston **stalls**.

The stall has been seen directly. In experimental "pop-can" retraction profiles, the piston stopped
moving at drive levels below about 10 % (in either direction). The exact stall level will depend on
the machine and on how much friction has built up.

This is why the card uses moves with a fixed, known drive or speed. The comparison between
measurements then depends on friction, not on how hard the profile happened to drive the piston.

### Cold starts (why the manual raise isn't used)

On the development machine, a manual raise took clearly more current when the machine was **cold
and had been standing still**:

- After 45 min to 10 h of rest at room temperature: about 15–20 % more than normal.
- A second raise a minute later: normal again.
- A raise after a similar rest with the machine still warm: also normal.

A plausible cause is cold seals settling while the machine stands and needing extra breakaway force
on the first move. A manual lower normally follows a raise, so it doesn't see this effect. That
makes the lower the cleaner manual measure, and the raise was left out.

### The retraction measure, step by step

Per shot, from the machine's ~10 Hz sensor stream:

1. Use only the retraction **after** the shot, not the one before it.
2. Keep the samples where all of these hold:
   - |drive| ≥ 99 %: fixed effort.
   - Pressure < 0.1 bar: skips the pressure release, which depends on the puck.
   - Speed ≥ 8 mm/s: steady motion only.
   - Piston position between 35 and 55 mm: the same stretch of cylinder every shot. Start points
     vary with the dose, and friction can vary along the bore.
3. With at least 5 such samples (about 0.5 s), the shot's value is their **median current**. The
   median speed is the Speed measure.

The integration publishes these as *Piston After-Shot Current* and *Piston After-Shot Speed*. The
first time the sensors exist, it reads the shots stored on the machine and imports the same values
into Home Assistant's long-term statistics, so the card has history from the start. The integration
action `meticulous_espresso.import_shot_history` repeats the import; running it again is safe.

### Data sources

- **Recent measurements** come from the recorder history: one value per move, at the moment it
  happened.
- **Older measurements** (beyond the recorder's retention, 10 days by default) come from long-term
  statistics. These keep hourly means, so two shots within the same hour show as one point.
- **Repeated values:** identical values within 6 hours are treated as one, because restarts can
  re-publish the same value.
- **Loading failures:** if history can't be loaded (e.g. a wall tablet just woke up), the card keeps
  what it had and retries after 5 s, 10 s, 20 s…

## Background: the analysis behind the card

The card's choices come from the full shot history of one machine: 506 shots from January to
October 2026, plus a week of manual raises and lowers. The absolute values below are specific to
that machine. They're here to show why the method was chosen and what a maintenance cycle can look
like.

### Looking for a measure that works for every user

Manual moves only happen when someone cleans the machine by hand, so a measure taken during normal
shots was needed. Two candidates were tested on the machine's shot records (motor current, drive,
speed and position at ~10 Hz).

**Low-drive moves at 0 bar** (the slow fill and pre-brew moves at the start of a shot) were **not
usable**. Even after correcting for speed, they barely responded to maintenance. During these moves
the motor also pushes water into the basket, and that load depends on the profile.

**The retraction after every shot** responded **clearly**. Because the drive level is always the
same, no speed correction is needed. On this machine speed and current followed the motor's own line
(speed ≈ 11.2 − 1.08 × current).

| On the development machine | Retraction current |
|---|---|
| Shots with a usable value | 466 of 506 |
| Same-day shot-to-shot noise | about 0.035 A, rising to about 0.08 A when friction was high |
| Drop at a maintenance in May | 1.49 → 0.99 A (14× the noise) |
| Drop at a maintenance in late August | 1.32 → 1.05 A (8× the noise) |
| After 3+ weeks without use | rose from about 1.1 to 1.3 A |
| Rise over the following cycle | about 1.0 → 1.6 A (+60 %) |

Some other observations:
- **Lubrication along the stroke:** right after greasing the current was flat along the stroke.
  Later it varied along the stroke and between shots, which fits uneven lubrication.
- **Temperature correction:** this was tried and didn't reduce the scatter reliably, so the card
  smooths with a 7-day median instead.
- **Not pure friction:** the retraction may include a little suction through the puck. It still
  tracked maintenance far better than anything else in the data.

### Retraction against manual moves

Over eight days with both manual and shot data, each measure was fitted with a straight line, and the
scatter around that line was taken as its noise:

| Measure (development machine) | Scatter around the trend | Days to see a change of 2× the scatter |
|---|---|---|
| Lower, current | 19 mA | about 3 |
| Raise (warm, cold starts left out), current | 27 mA | about 7 |
| Retraction, current, single shots | 200 mA | about 16 |

The lower gives the sharpest short-term reading and the raise adds little on top of it. The
retraction is noisier shot to shot, but it is the only measure every user gets, and it shows
maintenance most clearly over weeks and months.

### Time or shot count?

Shot count was tried as the x-axis instead of time. It fitted no better, and during a 25-day break
without shots the retraction current still rose noticeably. Friction builds with time and standing
still as well as with use, so the card keeps time on the axis.
