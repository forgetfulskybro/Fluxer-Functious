import type DatabaseHandler from './handlers/database';
import type TranslationHandler from './handlers/translation';
import type Sentry from '@sentry/node';
import type config from './config';
import type { Collection } from '@discordjs/collection';

declare module '@fluxerjs/core' {
	export interface Client {
		database: DatabaseHandler;
		translate: TranslationHandler;
		sentry: typeof Sentry;
		config: typeof config;
		aliases: Collection<string, any>;
		commands: Collection<string, any>;
		event: Collection<string, any>;
		functions: Collection<string, any>;
		reactionHandle: Collection<string, any>;
		observedVoiceUsers: Map<string, any>;
		observedVoiceBots: Map<string, any>;
		reactions: Map<string, any>;
		paginate: Map<string, any>;
		timeout: Map<string, any>;
		polls: Map<string, any>;
		used: Map<string, any>;
		messageCollector: Map<string, any>;
		messageEdit: Map<string, any>;
	}
}
