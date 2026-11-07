import {
	BasesEntry,
	BasesEntryGroup,
	BasesPropertyId,
	BasesView,
	DateValue,
	QueryController,
} from 'obsidian';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

interface TimelineItem {
	entry: BasesEntry;
	startDay: number;
	endDay: number;
	startLabel: string;
	endLabel: string;
}

interface TimelineMonth {
	startDay: number;
	dayCount: number;
	label: string;
}

export class TimelineView extends BasesView {
	type = 'timeline';
	private readonly contentEl: HTMLElement;

	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller);
		this.contentEl = containerEl.createDiv({ cls: 'timeline-view' });
	}

	onDataUpdated() {
		this.render();
	}

	private render() {
		this.contentEl.empty();

		const startProperty = this.config.getAsPropertyId('startProperty');
		if (!startProperty) {
			this.renderEmptyState(
				'Choose a start date',
				'Open the view options and select a frontmatter property for the start date.',
			);
			return;
		}

		const endProperty = this.config.getAsPropertyId('endProperty');
		const groups = this.data.groupedData;
		const itemsByGroup = groups.map((group) => ({
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

		const earliestDay = Math.min(...items.map((item) => item.startDay));
		const latestDay = Math.max(...items.map((item) => item.endDay));
		const firstMonth = startOfMonth(earliestDay);
		const afterLastMonth = startOfNextMonth(latestDay);
		const totalDays = afterLastMonth - firstMonth;
		const dayWidth = Math.max(1, Math.min(28, 8000 / totalDays));
		const months = this.createMonths(firstMonth, afterLastMonth);
		const boardWidth = totalDays * dayWidth;
		const board = this.contentEl.createDiv({ cls: 'timeline-board' });
		board.style.width = `${boardWidth}px`;

		this.renderAxis(board, months, firstMonth, dayWidth);
		for (const { group, items: groupItems } of itemsByGroup) {
			if (groupItems.length === 0) continue;
			this.renderGroup(
				board,
				group,
				groupItems,
				months,
				firstMonth,
				dayWidth,
			);
		}
	}

	private createItem(
		entry: BasesEntry,
		startProperty: BasesPropertyId,
		endProperty: BasesPropertyId | null,
	): TimelineItem | null {
		const startValue = entry.getValue(startProperty);
		if (!startValue) return null;

		const startDate = DateValue.parseFromString(startValue.toString());
		if (!startDate) return null;
		const startTimestamp = Date.parse(startDate.toString());
		if (!Number.isFinite(startTimestamp)) return null;
		const startDay = Math.floor(startTimestamp / DAY_IN_MILLISECONDS);

		const endValue = endProperty ? entry.getValue(endProperty) : null;
		const endDate = endValue
			? DateValue.parseFromString(endValue.toString())
			: null;
		const endTimestamp = endDate ? Date.parse(endDate.toString()) : NaN;
		const parsedEndDay = Number.isFinite(endTimestamp)
			? Math.floor(endTimestamp / DAY_IN_MILLISECONDS)
			: startDay;
		const endDay = Math.max(startDay, parsedEndDay);

		return {
			entry,
			startDay,
			endDay,
			startLabel: startDate.toString(),
			endLabel: endDate?.toString() ?? startDate.toString(),
		};
	}

	private createMonths(firstMonth: number, afterLastMonth: number) {
		const months: TimelineMonth[] = [];
		for (let monthStart = firstMonth; monthStart < afterLastMonth; ) {
			const nextMonth = startOfNextMonth(monthStart);
			months.push({
				startDay: monthStart,
				dayCount: nextMonth - monthStart,
				label: new Date(monthStart * DAY_IN_MILLISECONDS).toLocaleDateString(
					undefined,
					{ month: 'short', year: 'numeric', timeZone: 'UTC' },
				),
			});
			monthStart = nextMonth;
		}
		return months;
	}

	private renderAxis(
		board: HTMLElement,
		months: TimelineMonth[],
		firstMonth: number,
		dayWidth: number,
	) {
		const axis = board.createDiv({ cls: 'timeline-axis' });
		for (const month of months) {
			const cell = axis.createDiv({ cls: 'timeline-axis-month' });
			cell.setText(month.label);
			cell.style.width = `${month.dayCount * dayWidth}px`;
			cell.style.left = `${(month.startDay - firstMonth) * dayWidth}px`;
		}
	}

	private renderGroup(
		board: HTMLElement,
		group: BasesEntryGroup,
		items: TimelineItem[],
		months: TimelineMonth[],
		firstMonth: number,
		dayWidth: number,
	) {
		const section = board.createDiv({ cls: 'timeline-group' });
		if (group.hasKey()) {
			section
				.createDiv({ cls: 'timeline-group-heading' })
				.setText(group.key?.toString() ?? '');
		}

		for (const item of items) {
			const lane = section.createDiv({ cls: 'timeline-lane' });
			for (const month of months) {
				const line = lane.createDiv({ cls: 'timeline-gridline' });
				line.style.left = `${(month.startDay - firstMonth) * dayWidth}px`;
			}

			const entry = lane.createEl('a', {
				cls: `timeline-entry${item.endDay > item.startDay ? ' is-range' : ' is-point'}`,
				attr: {
					href: item.entry.file.path,
					'data-href': item.entry.file.path,
					'aria-label': this.getAriaLabel(item),
					title: this.getAriaLabel(item),
				},
			});
			entry.style.left = `${(item.startDay - firstMonth) * dayWidth}px`;
			if (item.endDay > item.startDay) {
				entry.style.width = `${Math.max(
					dayWidth,
					(item.endDay - item.startDay) * dayWidth,
				)}px`;
			}

			const marker = entry.createSpan({ cls: 'timeline-entry-marker' });
			marker.setAttribute('aria-hidden', 'true');
			entry.createSpan({
				cls: 'timeline-entry-title',
				text: item.entry.file.basename,
			});
		}
	}

	private getAriaLabel(item: TimelineItem) {
		return item.endDay > item.startDay
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
}

function startOfMonth(day: number) {
	const date = new Date(day * DAY_IN_MILLISECONDS);
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) /
		DAY_IN_MILLISECONDS;
}

function startOfNextMonth(day: number) {
	const date = new Date(day * DAY_IN_MILLISECONDS);
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) /
		DAY_IN_MILLISECONDS;
}
