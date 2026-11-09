import {
	BasesPropertyId,
	BasesPropertyOption,
	BasesViewConfig,
	Notice,
	Plugin,
} from 'obsidian';
import { TimelineView } from './views/timeline';

export default class TimelinePlugin extends Plugin {
	onload() {
		const registered = this.registerBasesView('timeline', {
			name: 'Timeline',
			icon: 'calendar-days',
			factory: (controller, containerEl) =>
				new TimelineView(controller, containerEl),
			options: (config) => [
				...createPropertyOptions(config, 'startProperty', 'Start date'),
				...createPropertyOptions(
					config,
					'endProperty',
					'End date',
					new Set(getConfiguredPropertyIds(config, 'startProperty')),
				),
			],
		});

		if (!registered) {
			new Notice('Enable the bases core plugin to use the timeline view.');
		}
	}
}

function createPropertyOptions(
	config: BasesViewConfig,
	keyPrefix: string,
	label: string,
	excludedProperties = new Set<BasesPropertyId>(),
): BasesPropertyOption[] {
	const options: BasesPropertyOption[] = [];
	const selectedProperties = new Set(excludedProperties);

	for (let index = 0; ; index++) {
		const key = index === 0 ? keyPrefix : `${keyPrefix}${index + 1}`;
		const property = config.getAsPropertyId(key);
		const excludedForOption = new Set(selectedProperties);
		options.push({
			key,
			type: 'property',
			displayName: index === 0 ? label : '',
			placeholder: index === 0 ? 'Select a date property' : 'Optional',
			filter: (candidate) =>
				candidate.startsWith('note.') &&
				!excludedForOption.has(candidate),
		});
		if (property?.startsWith('note.')) {
			selectedProperties.add(property);
			continue;
		}
		const nextProperty = config.getAsPropertyId(
			`${keyPrefix}${index + 2}`,
		);
		if (!nextProperty?.startsWith('note.')) break;
	}

	return options;
}

function getConfiguredPropertyIds(
	config: BasesViewConfig,
	keyPrefix: string,
): BasesPropertyId[] {
	const properties: BasesPropertyId[] = [];
	for (let index = 0; ; index++) {
		const key = index === 0 ? keyPrefix : `${keyPrefix}${index + 1}`;
		const property = config.getAsPropertyId(key);
		if (property?.startsWith('note.')) {
			properties.push(property);
			continue;
		}
		const nextProperty = config.getAsPropertyId(
			`${keyPrefix}${index + 2}`,
		);
		if (!nextProperty?.startsWith('note.')) break;
	}
	return properties;
}
