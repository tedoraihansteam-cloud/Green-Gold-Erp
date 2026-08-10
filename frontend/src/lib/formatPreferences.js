const original = {
    date: Date.prototype.toLocaleDateString,
    time: Date.prototype.toLocaleTimeString,
    dateTime: Date.prototype.toLocaleString
};

function preferences() {
    try { return JSON.parse(localStorage.getItem('ggerp:appearance') || '{}'); }
    catch { return {}; }
}

function localeAndOptions(kind) {
    const p = preferences();
    const locale = p.locale === 'bn-BD' ? 'bn-BD' : p.dateFormat === 'MM/DD/YYYY' ? 'en-US' : 'en-GB';
    const date = p.dateFormat === 'MM/DD/YYYY'
        ? { year: 'numeric', month: '2-digit', day: '2-digit' }
        : p.dateFormat === 'YYYY-MM-DD'
            ? { year: 'numeric', month: '2-digit', day: '2-digit' }
            : { day: '2-digit', month: '2-digit', year: 'numeric' };
    const time = { hour: '2-digit', minute: '2-digit', hour12: p.timeFormat !== '24-hour', timeZone: 'Asia/Dhaka' };
    if (kind === 'date') return { locale, options: { ...date, timeZone: 'Asia/Dhaka' }, dateFormat: p.dateFormat || 'DD/MM/YYYY' };
    if (kind === 'time') return { locale, options: time };
    return { locale, options: { ...date, ...time }, dateFormat: p.dateFormat || 'DD/MM/YYYY' };
}

function render(date, kind) {
    const cfg = localeAndOptions(kind);
    if (kind === 'time') return new Intl.DateTimeFormat(cfg.locale, cfg.options).format(date);
    const dateParts = new Intl.DateTimeFormat(cfg.locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Dhaka' }).formatToParts(date);
    const get = (name) => dateParts.find((part) => part.type === name)?.value || '';
    const formattedDate = cfg.dateFormat === 'YYYY-MM-DD' ? `${get('year')}-${get('month')}-${get('day')}`
        : cfg.dateFormat === 'MM/DD/YYYY' ? `${get('month')}/${get('day')}/${get('year')}`
            : `${get('day')}/${get('month')}/${get('year')}`;
    if (kind === 'date') return formattedDate;
    const p = preferences();
    const formattedTime = new Intl.DateTimeFormat(cfg.locale, { hour: '2-digit', minute: '2-digit', hour12: p.timeFormat !== '24-hour', timeZone: 'Asia/Dhaka' }).format(date);
    return `${formattedDate}, ${formattedTime}`;
}

export function installPreferenceAwareDateFormatting() {
    if (Date.prototype.__ggerpPreferenceFormatting) return;
    Object.defineProperty(Date.prototype, '__ggerpPreferenceFormatting', { value: true });
    Date.prototype.toLocaleDateString = function(locales, options) { return locales || options ? original.date.call(this, locales, options) : render(this, 'date'); };
    Date.prototype.toLocaleTimeString = function(locales, options) { return locales || options ? original.time.call(this, locales, options) : render(this, 'time'); };
    Date.prototype.toLocaleString = function(locales, options) { return locales || options ? original.dateTime.call(this, locales, options) : render(this, 'dateTime'); };
}
