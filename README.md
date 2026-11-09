# Timeline View

Timeline View adds a horizontal timeline layout to Obsidian Bases.

## Use

1. Enable the Bases core plugin and create or open a Base.
2. Add a **Timeline** view.
3. Open the view options and choose a frontmatter property for **Start date**.
4. Optionally choose an **End date** to display notes as date ranges. Without an end date, notes appear as milestones. Selecting a property reveals another property picker, so you can add fallbacks in priority order. For each note, the first selected property with a valid date is used.
5. Use the **+** and **−** controls to adjust the timeline scale.

Dates should use ISO format, such as `2026-04-15`. Click an entry to open its note. Drag an entry to move its date; drag either end of a date range to change just that endpoint. On mobile, swipe to scroll the timeline and press and hold an entry before dragging it; resizing a date range from its ends is disabled. Dates are updated in frontmatter. Bases grouping and sorting are respected.
