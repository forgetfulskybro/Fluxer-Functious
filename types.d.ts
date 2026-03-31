import DatabaseHandler from './handlers/database';
import TranslationHandler from './handlers/translation';
import Sentry from '@sentry/node'
import config from './config'
import { Collection } from '@discordjs/collection';

declare module '@fluxerjs/core' {
  export interface Client {
    database: DatabaseHandler
    translate: TranslationHandler
    sentry: typeof Sentry
    config: typeof config
    aliases: Collection<string, any>
    commands: Collection<string, any>
    event: Collection<string, any>
    functions: Collection<string, any>
    reactionHandle: Collection<string, any>
    observedVoiceUsers: Map<string, any> 
    observedVoiceBots: Map<string, any> 
    reactions: Map<string, any> 
    paginate: Map<string, any> 
    timeout: Map<string, any> 
    polls: Map<string, any> 
    used: Map<string, any> 
    messageCollector: Map<string, any> 
    messageEdit: Map<string, any>
  }
}