const color = require("../functions/colorCodes")

const BASE_LANGUAGE = 'en_EN';

class TranslationHandler {
    constructor(languages) {

        this.availableLanguages = languages ?? [
          'en_EN',
          'es_ES',
          'fr_FR',
          'pl_PL',
          'ar_AR',
          'pt_BR',
          //'sk_SK',
        ];

        this.baseLanguage = BASE_LANGUAGE;
        this.translations = {};
        this.progress = new Map();

        for (const l of this.availableLanguages) {
            const data = require(`../languages/${l}.json`);
            this.initLanguage(l, data);
        }

        console.log(color("%", `%b[Translation_Handler]%7 :: Loaded %e${this.availableLanguages.length} %7languages`));
    }

    initLanguage(key, language) {
        this.translations[key] = language;
        this.progress.delete(key);
    }

    checkRegex(value) {
        return /^[a-z]{2}_[A-Z]{2}$/.test(value);
    }

    getLanguage(language) {
        if (!this.checkRegex(language)) return this.translations['en_EN'];
        return this.translations[language];
    }

    addLanguage(language) {
        if (!this.checkRegex(language)) {
            throw new Error('Invalid language format. Example: en_EN');
        }

        this.availableLanguages.push(language);
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
            .map((language) => `\`${language}\` — ${this.formatProgress(language, options)}`)
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