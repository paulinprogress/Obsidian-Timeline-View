import {
	BasesEntry,
	BasesEntryGroup,
	BasesPropertyId,
	BasesView,
	DateValue,
	Notice,
	QueryController,
} from 'obsidian';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const DEFAULT_DAY_WIDTH = 16;
const MIN_DAY_WIDTH = 0.25;
const MAX_DAY_WIDTH = 80;
const ZOOM_FACTOR = 1.25;

type DragMode = 'move' | 'start' | 'end';
type TickUnit = 'day' | 'week' | 'month' | 'year';

interface TimelineItem {
	entry: BasesEntry;
	startProperty: BasesPropertyId;
	endProperty: BasesPropertyId | null;
	startValue: string;
	endValue: string | null;
	startDay: number;
	endDay: number;
	startLabel: string;
	endLabel: string;
}

interface TimelineTick {
	startDay: number;
	label: string;
	isMajor: boolean;
}

interface TimelineDrag {
	item: TimelineItem;
	element: HTMLAnchorElement;
	mode: DragMode;
	pointerId: number;
	startX: number;
	initialLeft: number;
	dayWidth: number;
	didMove: boolean;
	deltaDays: number;
}

const TICK_INTERVALS: Array<{
	unit: TickUnit;
	step: number;
	approximateDays: number;
}> = [
	{ unit: 'week', step: 1, approximateDays: 7 },
	{ unit: 'month', step: 1, approximateDays: 30.44 },
	{ unit: 'month', step: 2, approximateDays: 60.88 },
	{ unit: 'month', step: 3, approximateDays: 91.31 },
	{ unit: 'month', step: 6, approximateDays: 182.63 },
	{ unit: 'year', step: 1, approximateDays: 365.25 },
	{ unit: 'year', step: 2, approximateDays: 730.5 },
	{ unit: 'year', step: 5, approximateDays: 1826.25 },
	{ unit: 'year', step: 10, approximateDays: 3652.5 },
];

export class TimelineView extends BasesView {
	type = 'timeline';
	private readonly contentEl: HTMLElement;
	private activeDrag: TimelineDrag | null = null;
	private ignoreNextClick = false;
	private dayWidth = DEFAULT_DAY_WIDTH;
	private didInitialScrollToNow = false;
	private timelineStartDay = 0;

	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller);
		this.contentEl = containerEl.createDiv({ cls: 'timeline-view' });
		this.registerDomEvent(this.contentEl, 'pointerdown', (event) =>
			this.onPointerDown(event),
		);
		this.registerDomEvent(this.contentEl, 'pointermove', (event) =>
			this.onPointerMove(event),
		);
		this.registerDomEvent(this.contentEl, 'pointerup', (event) =>
			this.onPointerUp(event),
		);
		this.registerDomEvent(this.contentEl, 'pointercancel', () =>
			this.cancelDrag(),
		);
		this.registerDomEvent(this.contentEl, 'click', (event) =>
			this.onClick(event),
		);
		this.registerDomEvent(this.contentEl, 'keydown', (event) =>
			this.onKeyDown(event),
		);
	}

	onDataUpdated() {
		this.render();
	}

	private render() {
		const previousScroll = this.contentEl.querySelector<HTMLElement>(
			'.timeline-scroll',
		);
		const previousScrollLeft = previousScroll?.scrollLeft ?? 0;
		const previousAnchorDay =
			this.timelineStartDay + previousScrollLeft / this.dayWidth;
		const shouldRestoreScroll =
			this.didInitialScrollToNow && previousScroll != null;
		this.contentEl.empty();

		const startProperty = this.config.getAsPropertyId('startProperty');
		if (!startProperty?.startsWith('note.')) {
			this.renderEmptyState(
				'Choose a start date',
				'Open the view options and select a frontmatter property for the start date.',
			);
			return;
		}

		const configuredEndProperty =
			this.config.getAsPropertyId('endProperty');
		const endProperty =
			configuredEndProperty?.startsWith('note.')
				? configuredEndProperty
				: null;
		const itemsByGroup = this.data.groupedData.map((group) => ({
			group,
			items: group.entries
				.map((entry) => this.createItem(entry, startProperty, endProperty))
				.filter((item): item is TimelineItem => item !== null),
		}));
		const items = itemsByGroup.flatMap(({ items: groupItems }) => groupItems);

		if (items.length === 0) {
			this.renderEmptyState(
				'No dated notes',
				'Notes with a valid start date will appear here.',
			);
			return;
		}

		const today = Math.floor(Date.now() / DAY_IN_MILLISECONDS);
		const interval = this.getTickInterval(this.dayWidth);
		const viewportWidth = this.contentEl.clientWidth || 800;
		const visibleDays = Math.ceil(viewportWidth / this.dayWidth);
		const paddedFirstDay = Math.min(
			...items.map((item) => item.startDay),
			today - Math.ceil(visibleDays / 3),
		);
		const paddedLastDay = Math.max(
			...items.map((item) => item.endDay),
			today + Math.ceil((visibleDays * 2) / 3),
		);
		const firstDay = alignedTick(paddedFirstDay, interval.unit, interval.step);
		const afterLastDay = nextTick(
			alignedTick(paddedLastDay, interval.unit, interval.step),
			interval.unit,
			interval.step,
		);
		this.timelineStartDay = firstDay;
		const ticks = this.createTicks(firstDay, afterLastDay, interval);
		const showDayMarks =
			this.dayWidth >= 12 && afterLastDay - firstDay <= 180;
		const boardWidth = (afterLastDay - firstDay) * this.dayWidth;

		this.renderToolbar();
		const scroll = this.contentEl.createDiv({ cls: 'timeline-scroll' });
		const isWeeklyScale = interval.unit === 'week' && interval.step === 1;
		const board = scroll.createDiv({
			cls: `timeline-board${isWeeklyScale ? ' is-weekly-scale' : ''}`,
		});
		board.style.width = `${boardWidth}px`;
		board.style.setProperty(
			'--timeline-week-width',
			`${this.dayWidth * 7}px`,
		);

		this.renderAxis(
			board,
			ticks,
			firstDay,
			afterLastDay,
			this.dayWidth,
			showDayMarks,
		);
		for (const { group, items: groupItems } of itemsByGroup) {
			if (groupItems.length === 0) continue;
			this.renderGroup(
				board,
				group,
				groupItems,
				ticks,
				firstDay,
				afterLastDay,
				this.dayWidth,
				showDayMarks,
			);
		}
		this.renderTodayLine(board, today, firstDay, this.dayWidth);

		if (!this.didInitialScrollToNow) {
			this.didInitialScrollToNow = true;
			window.requestAnimationFrame(() => this.scrollToToday());
		} else if (shouldRestoreScroll) {
			window.requestAnimationFrame(() =>
				this.scrollToDay(previousAnchorDay),
			);
		}
	}

	private renderToolbar() {
		const toolbar = this.contentEl.createDiv({ cls: 'timeline-toolbar' });
		const todayButton = toolbar.createEl('button', {
			cls: 'timeline-today-button',
			text: 'Today',
			attr: { 'aria-label': 'Scroll to today' },
		});
		todayButton.addEventListener('click', () => this.scrollToToday());
		toolbar.createDiv({
			cls: 'timeline-zoom-label',
			text: `Zoom ${Math.round((this.dayWidth / DEFAULT_DAY_WIDTH) * 100)}%`,
		});
		const zoomOut = toolbar.createEl('button', {
			cls: 'timeline-zoom-button',
			text: '−',
			attr: { 'aria-label': 'Zoom out', title: 'Zoom out' },
		});
		zoomOut.disabled = this.dayWidth <= MIN_DAY_WIDTH;
		zoomOut.addEventListener('click', () =>
			this.changeZoom(1 / ZOOM_FACTOR),
		);

		const zoomIn = toolbar.createEl('button', {
			cls: 'timeline-zoom-button',
			text: '+',
			attr: { 'aria-label': 'Zoom in', title: 'Zoom in' },
		});
		zoomIn.disabled = this.dayWidth >= MAX_DAY_WIDTH;
		zoomIn.addEventListener('click', () => this.changeZoom(ZOOM_FACTOR));
	}

	private createItem(
		entry: BasesEntry,
		startProperty: BasesPropertyId,
		endProperty: BasesPropertyId | null,
	): TimelineItem | null {
		const startValue = entry.getValue(startProperty);
		if (!startValue) return null;

		const startLabel = startValue.toString();
		const startDay = parseDay(startLabel);
		if (startDay === null) return null;

		const endValue = endProperty ? entry.getValue(endProperty) : null;
		const endLabel = endValue?.toString() ?? null;
		const parsedEndDay = endLabel ? parseDay(endLabel) : null;
		const hasValidEnd = parsedEndDay !== null;

		return {
			entry,
			startProperty,
			endProperty: hasValidEnd ? endProperty : null,
			startValue: startLabel,
			endValue: hasValidEnd ? endLabel : null,
			startDay,
			endDay: hasValidEnd
				? Math.max(startDay, parsedEndDay)
				: startDay,
			startLabel,
			endLabel: hasValidEnd ? endLabel ?? startLabel : startLabel,
		};
	}

	private getTickInterval(dayWidth: number) {
		return (
			TICK_INTERVALS.find(
				(candidate) => candidate.approximateDays * dayWidth >= 105,
			) ?? TICK_INTERVALS[TICK_INTERVALS.length - 1]!
		);
	}

	private createTicks(
		firstDay: number,
		afterLastDay: number,
		interval: (typeof TICK_INTERVALS)[number],
	) {
		const ticks: TimelineTick[] = [];
		let day = alignedTick(firstDay, interval.unit, interval.step);

		while (day < afterLastDay) {
			const isMajor = isYearStart(day);
			ticks.push({
				startDay: day,
				label: formatTick(
					day,
					interval.unit,
					interval.step,
					isMajor,
				),
				isMajor,
			});
			day = nextTick(day, interval.unit, interval.step);
		}
		return ticks;
	}

	private renderAxis(
		board: HTMLElement,
		ticks: TimelineTick[],
		firstDay: number,
		afterLastDay: number,
		dayWidth: number,
		showDayMarks: boolean,
	) {
		const axis = board.createDiv({ cls: 'timeline-axis' });
		if (showDayMarks) {
			for (let day = firstDay; day < afterLastDay; day++) {
				const mark = axis.createDiv({ cls: 'timeline-day-mark' });
				mark.style.left = `${(day - firstDay) * dayWidth}px`;
			}
		}
		for (const tick of ticks) {
			const cell = axis.createDiv({
				cls: `timeline-axis-tick${tick.isMajor ? ' is-major' : ''}`,
			});
			cell.setText(tick.label);
			cell.style.left = `${(tick.startDay - firstDay) * dayWidth}px`;
		}
	}

	private renderGroup(
		board: HTMLElement,
		group: BasesEntryGroup,
		items: TimelineItem[],
		ticks: TimelineTick[],
		firstDay: number,
		afterLastDay: number,
		dayWidth: number,
		showDayMarks: boolean,
	) {
		const section = board.createDiv({ cls: 'timeline-group' });
		if (group.hasKey()) {
			section
				.createDiv({ cls: 'timeline-group-heading' })
				.setText(group.key?.toString() ?? '');
		}

		for (const item of items) {
			const lane = section.createDiv({ cls: 'timeline-lane' });
			if (showDayMarks) {
				for (let day = firstDay; day < afterLastDay; day++) {
					const mark = lane.createDiv({ cls: 'timeline-day-mark' });
					mark.style.left = `${(day - firstDay) * dayWidth}px`;
				}
			}
			for (const tick of ticks) {
				const line = lane.createDiv({
					cls: `timeline-gridline${tick.isMajor ? ' is-major' : ''}`,
				});
				line.style.left = `${(tick.startDay - firstDay) * dayWidth}px`;
			}

			const isRange = item.endProperty !== null;
			const entry = lane.createEl('a', {
				cls: `timeline-entry internal-link${isRange ? ' is-range' : ' is-point'}`,
				attr: {
					href: item.entry.file.path,
					'data-href': item.entry.file.path,
					'aria-label': this.getAriaLabel(item),
					title: this.getAriaLabel(item),
					tabindex: '0',
				},
			});
			entry.style.left = `${(item.startDay - firstDay) * dayWidth}px`;
			if (isRange) {
				entry.style.width = `${Math.max(
					dayWidth,
					(item.endDay - item.startDay) * dayWidth,
				)}px`;
				this.addResizeHandle(entry, 'start');
				this.addResizeHandle(entry, 'end');
			}
			entry.createSpan({ cls: 'timeline-entry-marker' });
			entry.createSpan({
				cls: 'timeline-entry-title',
				text: item.entry.file.basename,
			});
		}
	}

	private addResizeHandle(entry: HTMLElement, edge: 'start' | 'end') {
		const handle = entry.createSpan({
			cls: `timeline-resize-handle timeline-resize-handle-${edge}`,
		});
		handle.setAttribute('aria-hidden', 'true');
		handle.setAttribute('title', `Drag to change the ${edge} date`);
	}

	private renderTodayLine(
		board: HTMLElement,
		today: number,
		firstDay: number,
		dayWidth: number,
	) {
		const line = board.createDiv({ cls: 'timeline-now-line' });
		line.style.left = `${(today - firstDay) * dayWidth}px`;
		line.createDiv({ cls: 'timeline-now-label', text: 'Today' });
	}

	private onPointerDown(event: PointerEvent) {
		if (event.button !== 0 || !(event.target instanceof HTMLElement)) return;
		const entry = event.target.closest<HTMLAnchorElement>('.timeline-entry');
		if (!entry || !this.contentEl.contains(entry)) return;

		const item = this.findItem(entry.dataset.href);
		if (!item) return;

		const handle = event.target.closest('.timeline-resize-handle');
		const mode: DragMode = handle?.classList.contains('timeline-resize-handle-start')
			? 'start'
			: handle?.classList.contains('timeline-resize-handle-end')
				? 'end'
				: 'move';
		if (mode !== 'move' && !item.endProperty) return;

		this.activeDrag = {
			item,
			element: entry,
			mode,
			pointerId: event.pointerId,
			startX: event.clientX,
			initialLeft: Number.parseFloat(entry.style.left) || 0,
			dayWidth: this.dayWidth,
			didMove: false,
			deltaDays: 0,
		};
		entry.setPointerCapture(event.pointerId);
		event.preventDefault();
	}

	private onPointerMove(event: PointerEvent) {
		const drag = this.activeDrag;
		if (!drag || drag.pointerId !== event.pointerId) return;

		const distance = event.clientX - drag.startX;
		if (!drag.didMove && Math.abs(distance) < 3) return;
		drag.didMove = true;
		drag.element.addClass('is-dragging');
		drag.deltaDays = Math.round(distance / drag.dayWidth);
		this.updateDraggedPosition(drag);
	}

	private onPointerUp(event: PointerEvent) {
		const drag = this.activeDrag;
		if (!drag || drag.pointerId !== event.pointerId) return;
		this.activeDrag = null;
		drag.element.removeClass('is-dragging');
		this.ignoreNextClick = true;
		window.setTimeout(() => (this.ignoreNextClick = false), 0);

		if (!drag.didMove || drag.deltaDays === 0) {
			this.openEntry(drag.item);
		} else {
			void this.saveDraggedDates(drag);
		}
	}

	private cancelDrag() {
		if (!this.activeDrag) return;
		this.activeDrag.element.removeClass('is-dragging');
		this.activeDrag = null;
		this.render();
	}

	private updateDraggedPosition(drag: TimelineDrag) {
		const { item, element, mode, dayWidth, deltaDays } = drag;
		const startDay =
			mode === 'start'
				? Math.min(item.endDay, item.startDay + deltaDays)
				: mode === 'move'
					? item.startDay + deltaDays
					: item.startDay;
		const endDay =
			mode === 'end'
				? Math.max(item.startDay, item.endDay + deltaDays)
				: mode === 'move'
					? item.endDay + deltaDays
					: item.endDay;

		element.style.left = `${drag.initialLeft + (startDay - item.startDay) * dayWidth}px`;
		if (item.endProperty) {
			element.style.width = `${Math.max(dayWidth, (endDay - startDay) * dayWidth)}px`;
		}
	}

	private async saveDraggedDates(drag: TimelineDrag) {
		const { item, mode, deltaDays } = drag;
		const startDay =
			mode === 'start'
				? Math.min(item.endDay, item.startDay + deltaDays)
				: mode === 'move'
					? item.startDay + deltaDays
					: item.startDay;
		const endDay =
			mode === 'end'
				? Math.max(item.startDay, item.endDay + deltaDays)
				: mode === 'move'
					? item.endDay + deltaDays
					: item.endDay;

		try {
			const changes: Array<{ property: BasesPropertyId; value: string }> = [];
			if (mode !== 'end') {
				changes.push({
					property: item.startProperty,
					value: shiftIsoDate(item.startValue, startDay - item.startDay),
				});
			}
			if (mode !== 'start' && item.endProperty && item.endValue) {
				changes.push({
					property: item.endProperty,
					value: shiftIsoDate(item.endValue, endDay - item.endDay),
				});
			}

			await this.app.fileManager.processFrontMatter(
				item.entry.file,
				(frontmatter: Record<string, unknown>) => {
					for (const change of changes) {
						setFrontmatterProperty(
							frontmatter,
							change.property.slice('note.'.length),
							change.value,
						);
					}
				},
			);
		} catch (error) {
			console.error('Failed to update timeline dates', error);
			new Notice(`Could not update dates for "${item.entry.file.basename}".`);
			this.render();
		}
	}

	private findItem(path: string | undefined) {
		if (!path) return null;
		const startProperty = this.config.getAsPropertyId('startProperty');
		if (!startProperty?.startsWith('note.')) return null;
		const endProperty = this.config.getAsPropertyId('endProperty');
		const entry = this.data.data.find(
			(candidate) => candidate.file.path === path,
		);
		return entry
			? this.createItem(
					entry,
					startProperty,
					endProperty?.startsWith('note.') ? endProperty : null,
				)
			: null;
	}

	private openEntry(item: TimelineItem) {
		void this.app.workspace.openLinkText(
			item.entry.file.path,
			item.entry.file.path,
			false,
		);
	}

	private onClick(event: MouseEvent) {
		if (!(event.target instanceof HTMLElement)) return;
		const entry = event.target.closest<HTMLAnchorElement>('.timeline-entry');
		if (!entry) return;
		event.preventDefault();
		if (this.ignoreNextClick) {
			this.ignoreNextClick = false;
			return;
		}
		const item = this.findItem(entry.dataset.href);
		if (item) this.openEntry(item);
	}

	private onKeyDown(event: KeyboardEvent) {
		if (event.key !== ' ') return;
		if (!(event.target instanceof HTMLElement)) return;
		const entry = event.target.closest<HTMLAnchorElement>('.timeline-entry');
		if (!entry) return;
		event.preventDefault();
		const item = this.findItem(entry.dataset.href);
		if (item) this.openEntry(item);
	}

	private getAriaLabel(item: TimelineItem) {
		return item.endProperty
			? `${item.entry.file.basename}: ${item.startLabel} – ${item.endLabel}`
			: `${item.entry.file.basename}: ${item.startLabel}`;
	}

	private renderEmptyState(title: string, description: string) {
		const emptyState = this.contentEl.createDiv({
			cls: 'timeline-empty-state',
		});
		emptyState.createEl('strong', { text: title });
		emptyState.createDiv({
			cls: 'timeline-empty-description',
			text: description,
		});
	}

	private changeZoom(factor: number) {
		this.dayWidth = Math.max(
			MIN_DAY_WIDTH,
			Math.min(MAX_DAY_WIDTH, this.dayWidth * factor),
		);
		this.render();
		window.requestAnimationFrame(() => this.scrollToToday());
	}

	private scrollToToday() {
		const today = Math.floor(Date.now() / DAY_IN_MILLISECONDS);
		this.scrollToDay(today, 1 / 3);
	}

	private scrollToDay(day: number, viewportFraction = 0) {
		const scroll = this.contentEl.querySelector<HTMLElement>(
			'.timeline-scroll',
		);
		if (!scroll) return;
		const position = (day - this.timelineStartDay) * this.dayWidth;
		scroll.scrollLeft = Math.max(0, position - scroll.clientWidth * viewportFraction);
	}
}

function parseDay(value: string) {
	const date = DateValue.parseFromString(value);
	if (!date) return null;
	const datePart = /^(\d{4}-\d{2}-\d{2})/.exec(date.toString())?.[1];
	if (!datePart) return null;
	const timestamp = Date.parse(`${datePart}T00:00:00Z`);
	return Number.isFinite(timestamp)
		? Math.floor(timestamp / DAY_IN_MILLISECONDS)
		: null;
}

function shiftIsoDate(value: string, days: number) {
	const match = /^(\d{4}-\d{2}-\d{2})(.*)$/.exec(value);
	if (!match || !match[1] || (!match[2] && value.length !== 10)) {
		throw new Error(`Unsupported date value: ${value}`);
	}
	const timestamp = Date.parse(`${match[1]}T00:00:00Z`);
	if (!Number.isFinite(timestamp)) {
		throw new Error(`Invalid date value: ${value}`);
	}
	const shifted = new Date(timestamp + days * DAY_IN_MILLISECONDS)
		.toISOString()
		.slice(0, 10);
	return `${shifted}${match[2]}`;
}

function setFrontmatterProperty(
	frontmatter: Record<string, unknown>,
	property: string,
	value: string,
) {
	if (Object.prototype.hasOwnProperty.call(frontmatter, property)) {
		frontmatter[property] = value;
		return;
	}

	const path = property.split('.');
	let current = frontmatter;
	for (const segment of path.slice(0, -1)) {
		const child = current[segment];
		if (typeof child !== 'object' || child === null || Array.isArray(child)) {
			current[segment] = {};
		}
		current = current[segment] as Record<string, unknown>;
	}
	const lastSegment = path.at(-1);
	if (lastSegment) current[lastSegment] = value;
}

function alignedTick(day: number, unit: TickUnit, step: number) {
	if (unit === 'day') return day;
	if (unit === 'week') {
		const monday = startOfWeek(day);
		const knownMonday = 4;
		return (
			Math.floor((monday - knownMonday) / (7 * step)) * 7 * step +
			knownMonday
		);
	}
	if (unit === 'month') {
		const date = new Date(day * DAY_IN_MILLISECONDS);
		const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth();
		const alignedMonth = Math.floor(monthIndex / step) * step;
		return (
			Date.UTC(Math.floor(alignedMonth / 12), alignedMonth % 12, 1) /
			DAY_IN_MILLISECONDS
		);
	}
	const date = new Date(day * DAY_IN_MILLISECONDS);
	const year = Math.floor(date.getUTCFullYear() / step) * step;
	return Date.UTC(year, 0, 1) / DAY_IN_MILLISECONDS;
}

function nextTick(day: number, unit: TickUnit, step: number) {
	if (unit === 'day') return day + step;
	if (unit === 'week') return day + 7 * step;
	if (unit === 'month') {
		const date = new Date(day * DAY_IN_MILLISECONDS);
		return (
			Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + step, 1) /
			DAY_IN_MILLISECONDS
		);
	}
	const date = new Date(day * DAY_IN_MILLISECONDS);
	return (
		Date.UTC(date.getUTCFullYear() + step, 0, 1) / DAY_IN_MILLISECONDS
	);
}

function formatTick(
	day: number,
	unit: TickUnit,
	step: number,
	isMajor: boolean,
) {
	const date = new Date(day * DAY_IN_MILLISECONDS);
	if (unit === 'day' || unit === 'week') {
		return date.toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC',
		});
	}
	if (unit === 'month') {
		if (step === 1) {
			return date.toLocaleDateString(undefined, {
				day: 'numeric',
				month: 'short',
				timeZone: 'UTC',
			});
		}
		if (isMajor) {
			return date.toLocaleDateString(undefined, {
				year: 'numeric',
				timeZone: 'UTC',
			});
		}
		return date.toLocaleDateString(undefined, {
			month: 'short',
			timeZone: 'UTC',
		});
	}
	return date.toLocaleDateString(undefined, {
		year: 'numeric',
		timeZone: 'UTC',
	});
}

function isYearStart(day: number) {
	const date = new Date(day * DAY_IN_MILLISECONDS);
	return date.getUTCMonth() === 0 && date.getUTCDate() === 1;
}

function startOfWeek(day: number) {
	const date = new Date(day * DAY_IN_MILLISECONDS);
	const daysSinceMonday = (date.getUTCDay() + 6) % 7;
	return day - daysSinceMonday;
}
