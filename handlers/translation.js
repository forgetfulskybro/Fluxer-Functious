const fs = require("fs");
const path = require("path");
const color = require("../functions/colorCodes")

const BASE_LANGUAGE = 'en_EN';
const LANGUAGE_REGEX = /^[a-z]{2}_[A-Z]{2}$/;

const LANGUAGE_NAMES = {
    en_EN: ['english'],
    de_DE: ['german', 'deutsch'],
    es_ES: ['spanish', 'espanol', 'castellano'],
    fr_FR: ['french', 'francais'],
    pl_PL: ['polish', 'polski'],
    ar_AR: ['arabic', 'arabiya'],
    pt_BR: ['portuguese', 'portugues', 'brasileiro'],
    tr_TR: ['turkish', 'turkce'],
};

function normalize(value) {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

class TranslationHandler {
    constructor(languages) {

        this.languagesDir = path.join(__dirname, "..", "languages");
        this.availableLanguages = languages ?? this.discoverLanguages();

        this.aliases = this.buildAliases();
        this.names = this.buildNames();

        this.baseLanguage = BASE_LANGUAGE;
        this.translations = {};
        this.progress = new Map();

        for (const l of this.availableLanguages) {
            try {
                const data = require(`../languages/${l}.json`);
                if (!data) continue;
                this.initLanguage(l, data);
            } catch (err) {
                console.error(color("%", `%b[Translation_Handler]%7 :: Failed to load %e${l}%7: ${err.message}`));
            }
        }

        console.log(color("%", `%b[Translation_Handler]%7 :: Loaded %e${this.availableLanguages.length} %7languages`));
    }

    discoverLanguages() {
        const discovered = [];

        try {
            for (const file of fs.readdirSync(this.languagesDir)) {
                if (!file.endsWith(".json")) continue;

                const code = file.slice(0, -".json".length);
                if (!LANGUAGE_REGEX.test(code)) continue;

                discovered.push(code);
            }
        } catch (err) {
            console.error(color("%", `%b[Translation_Handler]%7 :: Failed to scan languages directory: %e${err.message}`));
        }

        if (!discovered.includes(BASE_LANGUAGE)) discovered.push(BASE_LANGUAGE);

        discovered.sort((a, b) => (a === BASE_LANGUAGE ? -1 : b === BASE_LANGUAGE ? 1 : a.localeCompare(b)));

        return discovered;
    }

    initLanguage(key, language) {
        this.translations[key] = language;
        this.progress.delete(key);
    }

    checkRegex(value) {
        return LANGUAGE_REGEX.test(value);
    }

    buildAliases() {
        const aliases = {};
        for (const language of this.availableLanguages) {
            const short = language.split('_')[0];
            if (aliases[short] === undefined) aliases[short] = language;
            else aliases[short] = null;
        }
        return aliases;
    }

    buildNames() {
        const names = {};
        for (const language of this.availableLanguages) {
            for (const name of LANGUAGE_NAMES[language] ?? []) {
                const key = normalize(name);
                if (names[key] === undefined) names[key] = language;
                else names[key] = null;
            }
        }
        return names;
    }

    resolveLanguage(input) {
        if (!input || typeof input !== 'string') return null;

        const value = input.trim();
        if (this.availableLanguages.includes(value)) return value;

        const lower = value.toLowerCase();
        const match = this.availableLanguages.find((l) => l.toLowerCase() === lower);
        if (match) return match;

        const short = lower.split('_')[0];
        if (this.aliases[short] !== undefined) return this.aliases[short];

        return this.names[normalize(value)] ?? null;
    }

    getAlias(language) {
        const short = language.split('_')[0];
        return this.aliases[short] === language ? short : language;
    }

    getLanguageNames(language) {
        return LANGUAGE_NAMES[language] ?? [];
    }

    getLanguage(language) {
        const resolved = this.resolveLanguage(language);
        if (!resolved) return this.translations['en_EN'];
        return this.translations[resolved];
    }

    addLanguage(language) {
        if (!this.checkRegex(language)) {
            throw new Error('Invalid language format. Example: en_EN');
        }

        this.availableLanguages.push(language);
        this.aliases = this.buildAliases();
        this.names = this.buildNames();
    }

    getLanguageProgress(language) {
        if (this.progress.has(language)) return this.progress.get(language);

        const baseStrings = this.getBaseStrings();
        const paths = Object.keys(baseStrings);
        const total = paths.length;

        if (language === this.baseLanguage) {
            return this.cacheProgress(language, {
                language,
                total,
                translated: total,
                unchanged: 0,
                empty: 0,
                missing: 0,
            });
        }

        const target = this.translations[language];
        if (!target) {
            return this.cacheProgress(language, {
                language,
                total,
                translated: 0,
                unchanged: 0,
                empty: 0,
                missing: total,
            });
        }

        let translated = 0;
        let unchanged = 0;
        let empty = 0;
        let missing = 0;

        for (const path of paths) {
            const value = this.read(target, path);

            if (value === undefined || value === null) {
                missing++;
                continue;
            }

            if (typeof value === 'string' && value.trim() === '') {
                empty++;
                continue;
            }

            if (value === baseStrings[path]) unchanged++;
            else translated++;
        }

        return this.cacheProgress(language, {
            language,
            total,
            translated,
            unchanged,
            empty,
            missing,
        });
    }

    getLanguagesProgress(languages = this.availableLanguages) {
        return languages
            .filter((language) => language !== this.baseLanguage)
            .map((language) => this.getLanguageProgress(language));
    }

    getBaseStrings() {
        return this.flatten(this.translations[this.baseLanguage] ?? {});
    }

    flatten(object, prefix = '', out = {}) {
        if (object === null || typeof object !== 'object') {
            out[prefix] = object;
            return out;
        }

        for (const [key, value] of Object.entries(object)) {
            this.flatten(value, prefix ? `${prefix}.${key}` : key, out);
        }

        return out;
    }

    read(object, path) {
        let current = object;
        for (const segment of path.split('.')) {
            if (current === null || typeof current !== 'object') return undefined;
            if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
            current = current[segment];
        }
        return current;
    }

    cacheProgress(language, result) {
        result.coverage = this.percent(result.total - result.missing - result.empty, result.total);
        result.percent = this.percent(result.translated, result.total);
        this.progress.set(language, result);
        return result;
    }

    percent(value, total) {
        if (!total) return 0;
        return Math.round((value / total) * 100 * 100) / 100;
    }

    formatProgress(language, options = {}) {
        const progress = this.getLanguageProgress(language);
        const counts = options.counts === false ? '' : ` (${progress.translated}/${progress.total})`;

        return `${progress.percent.toFixed(1)}%${counts}`;
    }

    formatProgressReport(languages = this.availableLanguages, options = {}) {
        const separator = options.separator ?? '\n';
        return languages
            .map((language) => `\`${language}\` - ${this.formatProgress(language, options)}`)
            .join(separator);
    }

    reload() {
        this.translations = {};
        this.progress.clear();
        for (const l of this.availableLanguages) {
            try {
                const d = require(`../languages/${l}.json`);

                if (!d) continue;

                this.initLanguage(l, d);
            } catch (e) {
                return e.message;
            }
        }
        return "Success";
    }

    get(language, path, data = {}) {
        if (!language) language = 'en_EN';
        const l = this.getLanguage(language);
        const p = path.split('.');
        let c = null;

        if (p.length > 0) {
            for (const i of p) {
                try {
                    if (!c) {
                        if (!l.hasOwnProperty(i)) break;
                        c = l[i];
                    } else {
                        if (!c.hasOwnProperty(i)) break;
                        c = c[i];
                    }
                } catch (err) {
                    break;
                }
            }
        } else {
            return `Unknown translation: ${language} | ${path}`;;
        }

        if (!c) return `Unknown translation: ${language} | ${path}`;;

        if (data) {
            try {
                return c
                    .replace(/{(\w+)}/g, (match, key) => data[key] ?? match)
                    .replace(/<(?:[@#&!]*)(\w+)>/g, (match, key) => data[key] ?? match);
            } catch (e) {
                return `Unknown translation: ${language} | ${path}`;
            }
        }

        return c;
    }
};

module.exports = TranslationHandler;