import { Notice, Plugin } from 'obsidian';
import { TimelineView } from './views/timeline';

export default class TimelinePlugin extends Plugin {
	onload() {
		const registered = this.registerBasesView('timeline', {
			name: 'Timeline',
			icon: 'calendar-days',
			factory: (controller, containerEl) =>
				new TimelineView(controller, containerEl),
			options: (config) => [
				{
					key: 'startProperty',
					type: 'property',
					displayName: 'Start date',
					placeholder: 'Select a date property',
					filter: (property) => property.startsWith('note.'),
				},
				{
					key: 'endProperty',
					type: 'property',
					displayName: 'End date',
					placeholder: 'Optional',
					filter: (property) =>
						property.startsWith('note.') &&
						property !== config.getAsPropertyId('startProperty'),
				},
			],
		});

		if (!registered) {
			new Notice('Enable the bases core plugin to use the timeline view.');
		}
	}
}
