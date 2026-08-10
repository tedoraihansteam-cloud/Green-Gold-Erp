import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { api } from '../lib/apiClient';

const defaults = {
    theme: 'system',
    accent: 'green',
    density: 'comfortable',
    sidebarMode: 'expanded',
    locale: 'en-BD',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '12-hour',
    defaultPrintSize: 'A4',

    reducedMotion: false,
    largerText: false,
    highContrast: false,

    defaultDashboard: 'overview',
    dashboardWidgets: [],

    operationalScopeId: '',
    operationalScopeName: '',
    operationalScopeType: ''
};

const accents = [
    'green',
    'emerald',
    'blue',
    'indigo',
    'purple',
    'rose',
    'orange',
    'gold',
    'teal',
    'slate'
];

function readCachedPreferences() {
    try {
        return JSON.parse(
            localStorage.getItem('ggerp:appearance') || '{}'
        );
    } catch {
        return {};
    }
}

function applyPreview(prefs) {
    const root = document.documentElement;

    root.dataset.theme = prefs.theme || 'system';
    root.dataset.accent = prefs.accent || 'green';
    root.dataset.density = prefs.density || 'comfortable';
    root.dataset.sidebar = prefs.sidebarMode || 'expanded';

    root.dataset.reducedMotion = String(
        Boolean(prefs.reducedMotion)
    );

    root.dataset.largerText = String(
        Boolean(prefs.largerText)
    );

    root.dataset.highContrast = String(
        Boolean(prefs.highContrast)
    );

    root.lang =
        prefs.locale === 'bn-BD'
            ? 'bn'
            : 'en';

    localStorage.setItem(
        'ggerp:appearance',
        JSON.stringify({
            theme: prefs.theme,
            accent: prefs.accent,
            density: prefs.density,
            sidebarMode: prefs.sidebarMode,
            locale: prefs.locale,
            dateFormat: prefs.dateFormat,
            timeFormat: prefs.timeFormat,

            operationalScopeId:
                prefs.operationalScopeId,

            operationalScopeName:
                prefs.operationalScopeName,

            operationalScopeType:
                prefs.operationalScopeType,

            reducedMotion:
                Boolean(prefs.reducedMotion),

            largerText:
                Boolean(prefs.largerText),

            highContrast:
                Boolean(prefs.highContrast)
        })
    );

    window.dispatchEvent(
        new CustomEvent(
            'ggerp:preferences-preview',
            {
                detail: prefs
            }
        )
    );
}

export default function ProfilePage() {
    const location = useLocation();

    const {
        data,
        loading,
        error,
        reload
    } = useApi('/users/me');

    const {
        data: companyData
    } = useApi('/company-settings');

    const [form, setForm] = useState({
        displayName: '',
        email: '',
        phone: '',
        profilePhotoUrl: '',
        preferences: defaults
    });

    const [message, setMessage] =
        useState('');

    const [formError, setFormError] =
        useState('');

    /*
     * PASSWORD & SECURITY
     */
    const [passwordForm, setPasswordForm] =
        useState({
            currentPassword: '',
            newPassword: '',
            confirmPassword: ''
        });

    const [passwordMessage, setPasswordMessage] =
        useState('');

    const [passwordError, setPasswordError] =
        useState('');

    const [passwordBusy, setPasswordBusy] =
        useState(false);

    const [showCurrentPassword, setShowCurrentPassword] =
        useState(false);

    const [showNewPassword, setShowNewPassword] =
        useState(false);

    const [showConfirmPassword, setShowConfirmPassword] =
        useState(false);

    const bn =
        form.preferences.locale === 'bn-BD';

    const t = (english, bangla) =>
        bn ? bangla : english;

    /*
     * Scroll directly to operational scope when
     * the URL contains #operational-scope
     */
    useEffect(() => {
        if (
            location.hash !== '#operational-scope' ||
            loading
        ) {
            return;
        }

        requestAnimationFrame(() => {
            document
                .getElementById('operational-scope')
                ?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
        });
    }, [location.hash, loading]);

    /*
     * Load profile information.
     */
    useEffect(() => {
        if (!data?.profile) return;

        const profile = data.profile;

        const preferences = {
            ...defaults,
            ...readCachedPreferences(),
            ...(profile.preferences || {})
        };

        setForm({
            displayName:
                profile.display_name || '',

            email:
                profile.email || '',

            phone:
                profile.phone || '',

            profilePhotoUrl:
                profile.profile_photo_url || '',

            preferences
        });

        applyPreview(preferences);
    }, [data]);

    /*
     * Change one personal interface preference.
     */
    function setPreference(key, value) {
        setForm((current) => {
            const preferences = {
                ...current.preferences,
                [key]: value
            };

            applyPreview(preferences);

            return {
                ...current,
                preferences
            };
        });
    }

    /*
     * Select user's current operational
     * office/factory/warehouse/location.
     */
    function setOperationalScope(siteId) {
        const site =
            (companyData?.sites || []).find(
                (entry) =>
                    entry.id === siteId
            );

        if (!site) return;

        setForm((current) => {
            const preferences = {
                ...current.preferences,

                operationalScopeId:
                    site.id,

                operationalScopeName:
                    site.name,

                operationalScopeType:
                    site.site_type
            };

            applyPreview(preferences);

            return {
                ...current,
                preferences
            };
        });
    }

    /*
     * Restore Green Gold interface defaults.
     */
    function resetAppearance() {
        setForm((current) => {
            const preferences = {
                ...current.preferences,
                ...defaults
            };

            applyPreview(preferences);

            return {
                ...current,
                preferences
            };
        });
    }

    /*
     * Save profile + preferences.
     */
    async function saveProfile(event) {
        event.preventDefault();

        setFormError('');
        setMessage('');

        try {
            await api.put(
                '/users/me',
                form
            );

            setMessage(
                t(
                    'Profile and personal preferences saved successfully.',
                    'প্রোফাইল এবং ব্যক্তিগত পছন্দ সফলভাবে সংরক্ষণ করা হয়েছে।'
                )
            );

            reload();
        } catch (err) {
            setFormError(
                err.message ||
                'Unable to save profile.'
            );
        }
    }

    /*
     * Change account password.
     */
    async function changePassword(event) {
        event.preventDefault();

        setPasswordError('');
        setPasswordMessage('');

        const currentPassword =
            passwordForm.currentPassword;

        const newPassword =
            passwordForm.newPassword;

        const confirmPassword =
            passwordForm.confirmPassword;

        if (
            !currentPassword ||
            !newPassword ||
            !confirmPassword
        ) {
            setPasswordError(
                t(
                    'Please complete all password fields.',
                    'সব পাসওয়ার্ড ঘর পূরণ করুন।'
                )
            );

            return;
        }

        if (newPassword.length < 8) {
            setPasswordError(
                t(
                    'New password must contain at least 8 characters.',
                    'নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।'
                )
            );

            return;
        }

        if (newPassword !== confirmPassword) {
            setPasswordError(
                t(
                    'New password and confirmation do not match.',
                    'নতুন পাসওয়ার্ড এবং নিশ্চিত পাসওয়ার্ড মিলছে না।'
                )
            );

            return;
        }

        if (currentPassword === newPassword) {
            setPasswordError(
                t(
                    'Your new password must be different from your current password.',
                    'নতুন পাসওয়ার্ড বর্তমান পাসওয়ার্ড থেকে আলাদা হতে হবে।'
                )
            );

            return;
        }

        try {
            setPasswordBusy(true);

            const result =
                await api.post(
                    '/auth/change-password',
                    {
                        currentPassword,
                        newPassword
                    }
                );

            setPasswordMessage(
                result?.message ||
                t(
                    'Password changed successfully.',
                    'পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে।'
                )
            );

            /*
             * Never retain password values
             * after successful change.
             */
            setPasswordForm({
                currentPassword: '',
                newPassword: '',
                confirmPassword: ''
            });

            setShowCurrentPassword(false);
            setShowNewPassword(false);
            setShowConfirmPassword(false);

        } catch (err) {
            setPasswordError(
                err.message ||
                t(
                    'Unable to change password.',
                    'পাসওয়ার্ড পরিবর্তন করা যায়নি।'
                )
            );
        } finally {
            setPasswordBusy(false);
        }
    }

    const selectedOperationalSite =
        (companyData?.sites || []).find(
            (site) =>
                site.id ===
                form.preferences
                    .operationalScopeId
        );

    if (loading) {
        return (
            <div
                className="skeleton-page"
                aria-label="Loading profile"
            >
                <div className="skeleton wide" />
                <div className="skeleton-card" />
            </div>
        );
    }

    return (
        <div>

            {/* PAGE HEADER */}

            <div className="page-header">
                <div>
                    <div className="breadcrumbs">
                        {t(
                            'Settings / My preferences',
                            'সেটিংস / আমার পছন্দ'
                        )}
                    </div>

                    <h1 className="page-title">
                        {t(
                            'My profile & appearance',
                            'আমার প্রোফাইল ও প্রদর্শন'
                        )}
                    </h1>

                    <p className="card-subtitle">
                        {t(
                            "Your interface choices follow your account and never alter company documents or another user's workspace.",
                            'আপনার ইন্টারফেস পছন্দ শুধু আপনার অ্যাকাউন্টে প্রযোজ্য; কোম্পানির নথি বা অন্য ব্যবহারকারীর কর্মক্ষেত্র পরিবর্তন করে না।'
                        )}
                    </p>
                </div>
            </div>

            {/* PROFILE SETTINGS FORM */}

            <form onSubmit={saveProfile}>

                {error && (
                    <div className="error-banner">
                        {error}
                    </div>
                )}

                {formError && (
                    <div className="error-banner">
                        {formError}
                    </div>
                )}

                {message && (
                    <div className="success-banner">
                        {message}
                    </div>
                )}

                {/* PERSONAL INFORMATION */}

                <section className="card">
                    <div className="card-header">
                        <div>
                            <h2>
                                {t(
                                    'Personal information',
                                    'ব্যক্তিগত তথ্য'
                                )}
                            </h2>

                            <p className="card-subtitle">
                                {t(
                                    'Account contact and display information',
                                    'অ্যাকাউন্টের যোগাযোগ ও প্রদর্শন তথ্য'
                                )}
                            </p>
                        </div>
                    </div>

                    <div className="form-grid">

                        <div className="field">
                            <label htmlFor="profile-display-name">
                                {t(
                                    'Display name',
                                    'প্রদর্শিত নাম'
                                )}
                            </label>

                            <input
                                id="profile-display-name"
                                value={form.displayName}
                                onChange={(e) =>
                                    setForm((current) => ({
                                        ...current,
                                        displayName:
                                            e.target.value
                                    }))
                                }
                            />
                        </div>

                        <div className="field">
                            <label htmlFor="profile-username">
                                {t(
                                    'Username',
                                    'ব্যবহারকারীর নাম'
                                )}
                            </label>

                            <input
                                id="profile-username"
                                disabled
                                value={
                                    data?.profile?.username ||
                                    ''
                                }
                            />
                        </div>

                        <div className="field">
                            <label htmlFor="profile-email">
                                {t(
                                    'Email',
                                    'ইমেইল'
                                )}
                            </label>

                            <input
                                id="profile-email"
                                type="email"
                                value={form.email}
                                onChange={(e) =>
                                    setForm((current) => ({
                                        ...current,
                                        email:
                                            e.target.value
                                    }))
                                }
                            />
                        </div>

                        <div className="field">
                            <label htmlFor="profile-phone">
                                {t(
                                    'Phone',
                                    'ফোন'
                                )}
                            </label>

                            <input
                                id="profile-phone"
                                value={form.phone}
                                onChange={(e) =>
                                    setForm((current) => ({
                                        ...current,
                                        phone:
                                            e.target.value
                                    }))
                                }
                            />
                        </div>
                    </div>

                    <div className="field">
                        <label htmlFor="profile-photo-url">
                            {t(
                                'Profile photo URL',
                                'প্রোফাইল ছবির URL'
                            )}
                        </label>

                        <input
                            id="profile-photo-url"
                            type="url"
                            value={form.profilePhotoUrl}
                            onChange={(e) =>
                                setForm((current) => ({
                                    ...current,
                                    profilePhotoUrl:
                                        e.target.value
                                }))
                            }
                        />
                    </div>
                </section>

                {/* APPEARANCE */}

                <section className="card">

                    <div className="card-header">

                        <div>
                            <h2>
                                {t(
                                    'Appearance',
                                    'প্রদর্শন'
                                )}
                            </h2>

                            <p className="card-subtitle">
                                {t(
                                    'Preview changes immediately, then save them to your ERP profile.',
                                    'পরিবর্তন সঙ্গে সঙ্গে দেখুন, তারপর ERP প্রোফাইলে সংরক্ষণ করুন।'
                                )}
                            </p>
                        </div>

                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={resetAppearance}
                        >
                            {t(
                                'Reset Green Gold default',
                                'গ্রিন গোল্ড ডিফল্ট পুনঃস্থাপন'
                            )}
                        </button>
                    </div>

                    <div className="preference-group">
                        <label>
                            {t(
                                'Appearance mode',
                                'প্রদর্শন মোড'
                            )}
                        </label>

                        <div className="segmented">

                            {[
                                ['light', 'Light', 'লাইট'],
                                ['system', 'System', 'সিস্টেম'],
                                ['dark', 'Dark', 'ডার্ক']
                            ].map(
                                ([value, en, bnText]) => (
                                    <button
                                        type="button"
                                        key={value}
                                        className={
                                            form.preferences
                                                .theme ===
                                            value
                                                ? 'selected'
                                                : ''
                                        }
                                        onClick={() =>
                                            setPreference(
                                                'theme',
                                                value
                                            )
                                        }
                                    >
                                        {t(
                                            en,
                                            bnText
                                        )}
                                    </button>
                                )
                            )}
                        </div>
                    </div>

                    <div className="preference-group">

                        <label>
                            {t(
                                'Interface accent',
                                'ইন্টারফেস রং'
                            )}
                        </label>

                        <div className="color-swatches">

                            {accents.map(
                                (accent) => (
                                    <button
                                        type="button"
                                        key={accent}
                                        className={
                                            `swatch swatch-${accent}` +
                                            (
                                                form.preferences
                                                    .accent ===
                                                accent
                                                    ? ' selected'
                                                    : ''
                                            )
                                        }
                                        aria-label={
                                            `${accent} interface color`
                                        }
                                        title={accent}
                                        onClick={() =>
                                            setPreference(
                                                'accent',
                                                accent
                                            )
                                        }
                                    />
                                )
                            )}
                        </div>
                    </div>

                    <div className="form-grid">

                        <div className="field">
                            <label htmlFor="profile-density">
                                {t(
                                    'Interface density',
                                    'ইন্টারফেস ঘনত্ব'
                                )}
                            </label>

                            <select
                                id="profile-density"
                                value={
                                    form.preferences
                                        .density
                                }
                                onChange={(e) =>
                                    setPreference(
                                        'density',
                                        e.target.value
                                    )
                                }
                            >
                                <option value="comfortable">
                                    {t(
                                        'Comfortable',
                                        'আরামদায়ক'
                                    )}
                                </option>

                                <option value="compact">
                                    {t(
                                        'Compact',
                                        'কম্প্যাক্ট'
                                    )}
                                </option>

                                <option value="dense">
                                    {t(
                                        'Dense',
                                        'ঘন'
                                    )}
                                </option>
                            </select>
                        </div>

                        <div className="field">
                            <label htmlFor="profile-sidebar">
                                {t(
                                    'Sidebar style',
                                    'সাইডবার ধরন'
                                )}
                            </label>

                            <select
                                id="profile-sidebar"
                                value={
                                    form.preferences
                                        .sidebarMode
                                }
                                onChange={(e) =>
                                    setPreference(
                                        'sidebarMode',
                                        e.target.value
                                    )
                                }
                            >
                                <option value="expanded">
                                    {t(
                                        'Expanded',
                                        'সম্প্রসারিত'
                                    )}
                                </option>

                                <option value="collapsed">
                                    {t(
                                        'Collapsed',
                                        'সংকুচিত'
                                    )}
                                </option>

                                <option value="auto">
                                    {t(
                                        'Auto-collapse',
                                        'স্বয়ংক্রিয় সংকোচন'
                                    )}
                                </option>

                                <option value="icon-only">
                                    {t(
                                        'Icon only',
                                        'শুধু আইকন'
                                    )}
                                </option>
                            </select>
                        </div>
                    </div>

                    <div className="preference-toggles">

                        <label>
                            <input
                                type="checkbox"
                                checked={
                                    Boolean(
                                        form.preferences
                                            .reducedMotion
                                    )
                                }
                                onChange={(e) =>
                                    setPreference(
                                        'reducedMotion',
                                        e.target.checked
                                    )
                                }
                            />

                            {t(
                                'Reduced animation',
                                'কম অ্যানিমেশন'
                            )}
                        </label>

                        <label>
                            <input
                                type="checkbox"
                                checked={
                                    Boolean(
                                        form.preferences
                                            .largerText
                                    )
                                }
                                onChange={(e) =>
                                    setPreference(
                                        'largerText',
                                        e.target.checked
                                    )
                                }
                            />

                            {t(
                                'Larger text',
                                'বড় লেখা'
                            )}
                        </label>

                        <label>
                            <input
                                type="checkbox"
                                checked={
                                    Boolean(
                                        form.preferences
                                            .highContrast
                                    )
                                }
                                onChange={(e) =>
                                    setPreference(
                                        'highContrast',
                                        e.target.checked
                                    )
                                }
                            />

                            {t(
                                'High contrast',
                                'উচ্চ কনট্রাস্ট'
                            )}
                        </label>

                    </div>

                    <div className="theme-preview">

                        <div className="preview-sidebar">
                            GG
                        </div>

                        <div className="preview-body">

                            <strong>
                                {t(
                                    'Live interface preview',
                                    'লাইভ ইন্টারফেস প্রিভিউ'
                                )}
                            </strong>

                            <p>
                                {t(
                                    'Cards, controls and navigation use your personal accent.',
                                    'কার্ড, কন্ট্রোল এবং নেভিগেশনে আপনার ব্যক্তিগত রং ব্যবহার হবে।'
                                )}
                            </p>

                            <button
                                type="button"
                                className="btn btn-primary"
                            >
                                {t(
                                    'Primary action',
                                    'প্রধান অ্যাকশন'
                                )}
                            </button>
                        </div>
                    </div>
                </section>

                {/* REGIONAL SETTINGS */}

                <section className="card">

                    <div className="card-header">
                        <h2>
                            {t(
                                'Regional & workspace defaults',
                                'আঞ্চলিক ও কর্মক্ষেত্র ডিফল্ট'
                            )}
                        </h2>
                    </div>

                    <div className="form-grid">

                        <div className="field">
                            <label htmlFor="profile-language">
                                {t(
                                    'Language',
                                    'ভাষা'
                                )}
                            </label>

                            <select
                                id="profile-language"
                                value={
                                    form.preferences
                                        .locale
                                }
                                onChange={(e) =>
                                    setPreference(
                                        'locale',
                                        e.target.value
                                    )
                                }
                            >
                                <option value="en-BD">
                                    English
                                </option>

                                <option value="bn-BD">
                                    বাংলা
                                </option>
                            </select>
                        </div>

                        <div className="field">
                            <label htmlFor="profile-date-format">
                                {t(
                                    'Date format',
                                    'তারিখের ধরন'
                                )}
                            </label>

                            <select
                                id="profile-date-format"
                                value={
                                    form.preferences
                                        .dateFormat
                                }
                                onChange={(e) =>
                                    setPreference(
                                        'dateFormat',
                                        e.target.value
                                    )
                                }
                            >
                                <option value="DD/MM/YYYY">
                                    DD/MM/YYYY
                                </option>

                                <option value="MM/DD/YYYY">
                                    MM/DD/YYYY
                                </option>

                                <option value="YYYY-MM-DD">
                                    YYYY-MM-DD
                                </option>
                            </select>
                        </div>

                        <div className="field">
                            <label htmlFor="profile-time-format">
                                {t(
                                    'Time format',
                                    'সময়ের ধরন'
                                )}
                            </label>

                            <select
                                id="profile-time-format"
                                value={
                                    form.preferences
                                        .timeFormat
                                }
                                onChange={(e) =>
                                    setPreference(
                                        'timeFormat',
                                        e.target.value
                                    )
                                }
                            >
                                <option value="12-hour">
                                    {t(
                                        '12 hour',
                                        '১২ ঘণ্টা'
                                    )}
                                </option>

                                <option value="24-hour">
                                    {t(
                                        '24 hour',
                                        '২৪ ঘণ্টা'
                                    )}
                                </option>
                            </select>
                        </div>

                        <div className="field">
                            <label htmlFor="profile-print-size">
                                {t(
                                    'Default print size',
                                    'ডিফল্ট প্রিন্ট সাইজ'
                                )}
                            </label>

                            <select
                                id="profile-print-size"
                                value={
                                    form.preferences
                                        .defaultPrintSize
                                }
                                onChange={(e) =>
                                    setPreference(
                                        'defaultPrintSize',
                                        e.target.value
                                    )
                                }
                            >
                                <option value="A4">
                                    A4{' '}
                                    {t(
                                        'document',
                                        'নথি'
                                    )}
                                </option>

                                <option value="label">
                                    {t(
                                        'Identity label',
                                        'পরিচয় লেবেল'
                                    )}
                                </option>
                            </select>
                        </div>
                    </div>

                </section>

                {/* OPERATIONAL SCOPE */}

                <section
                    className="card"
                    id="operational-scope"
                >

                    <div className="card-header">

                        <div>
                            <h2>
                                {t(
                                    'Operational scope',
                                    'কাজের স্থান'
                                )}
                            </h2>

                            <p className="card-subtitle">
                                {t(
                                    'Choose the office, factory, store or branch used as your current working location. Locations are managed in Application settings.',
                                    'আপনার বর্তমান কাজের স্থান হিসেবে অফিস, কারখানা, স্টোর বা শাখা নির্বাচন করুন। লোকেশন অ্যাপ্লিকেশন সেটিংসে পরিচালিত হয়।'
                                )}
                            </p>
                        </div>

                    </div>

                    <div className="form-grid">

                        <div className="field">

                            <label htmlFor="operationalScope">
                                {t(
                                    'Current office / factory / location',
                                    'বর্তমান অফিস / কারখানা / লোকেশন'
                                )}
                            </label>

                            <select
                                id="operationalScope"
                                value={
                                    form.preferences
                                        .operationalScopeId ||
                                    ''
                                }
                                onChange={(e) =>
                                    setOperationalScope(
                                        e.target.value
                                    )
                                }
                            >
                                <option
                                    value=""
                                    disabled
                                >
                                    {t(
                                        'Select a configured location',
                                        'কনফিগার করা লোকেশন নির্বাচন করুন'
                                    )}
                                </option>

                                {(companyData?.sites || [])
                                    .map((site) => (
                                        <option
                                            key={site.id}
                                            value={site.id}
                                        >
                                            {site.name}
                                            {' — '}
                                            {String(
                                                site.site_type ||
                                                'location'
                                            ).replaceAll(
                                                '_',
                                                ' '
                                            )}
                                        </option>
                                    ))}
                            </select>
                        </div>

                        <div className="field">

                            <label>
                                {t(
                                    'Selected location address',
                                    'নির্বাচিত লোকেশনের ঠিকানা'
                                )}
                            </label>

                            <div className="read-only-value">
                                {
                                    selectedOperationalSite
                                        ?.address ||
                                    t(
                                        'No location selected',
                                        'কোনো লোকেশন নির্বাচন করা হয়নি'
                                    )
                                }
                            </div>

                        </div>

                    </div>

                    {!(companyData?.sites || []).length && (

                        <p className="alert alert-warning">
                            {t(
                                'No locations are configured. Add one under Settings → Office & factory locations.',
                                'কোনো লোকেশন কনফিগার করা নেই। সেটিংস → অফিস ও কারখানার লোকেশনে যোগ করুন।'
                            )}
                        </p>

                    )}

                </section>

                {/* SAVE PROFILE */}

                <div className="sticky-form-actions">

                    <button
                        className="btn btn-primary"
                        type="submit"
                    >
                        {t(
                            'Save my preferences',
                            'আমার পছন্দ সংরক্ষণ করুন'
                        )}
                    </button>

                </div>

            </form>

            {/* ==================================================
                PASSWORD & SECURITY
                Separate form intentionally.
                Do NOT put it inside the profile form.
            ================================================== */}

            <section className="card">

                <div className="card-header">

                    <div>

                        <h2>
                            {t(
                                'Password & security',
                                'পাসওয়ার্ড ও নিরাপত্তা'
                            )}
                        </h2>

                        <p className="card-subtitle">
                            {t(
                                'Change the password you use to sign in to Green Gold ERP.',
                                'গ্রিন গোল্ড ERP-তে লগইন করার পাসওয়ার্ড পরিবর্তন করুন।'
                            )}
                        </p>

                    </div>

                </div>

                {passwordError && (
                    <div className="error-banner">
                        {passwordError}
                    </div>
                )}

                {passwordMessage && (
                    <div className="success-banner">
                        {passwordMessage}
                    </div>
                )}

                <form onSubmit={changePassword}>

                    {/* CURRENT PASSWORD */}

                    <div className="field">

                        <label htmlFor="currentPassword">
                            {t(
                                'Current password',
                                'বর্তমান পাসওয়ার্ড'
                            )}
                        </label>

                        <div
                            style={{
                                display: 'flex',
                                gap: 8
                            }}
                        >

                            <input
                                id="currentPassword"
                                type={
                                    showCurrentPassword
                                        ? 'text'
                                        : 'password'
                                }
                                autoComplete="current-password"
                                value={
                                    passwordForm.currentPassword
                                }
                                onChange={(e) =>
                                    setPasswordForm(
                                        (current) => ({
                                            ...current,
                                            currentPassword:
                                                e.target.value
                                        })
                                    )
                                }
                                required
                            />

                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() =>
                                    setShowCurrentPassword(
                                        (value) =>
                                            !value
                                    )
                                }
                            >
                                {showCurrentPassword
                                    ? t(
                                        'Hide',
                                        'লুকান'
                                    )
                                    : t(
                                        'Show',
                                        'দেখুন'
                                    )}
                            </button>

                        </div>

                    </div>

                    <div className="form-grid">

                        {/* NEW PASSWORD */}

                        <div className="field">

                            <label htmlFor="newPassword">
                                {t(
                                    'New password',
                                    'নতুন পাসওয়ার্ড'
                                )}
                            </label>

                            <div
                                style={{
                                    display: 'flex',
                                    gap: 8
                                }}
                            >

                                <input
                                    id="newPassword"
                                    type={
                                        showNewPassword
                                            ? 'text'
                                            : 'password'
                                    }
                                    autoComplete="new-password"
                                    minLength={8}
                                    value={
                                        passwordForm.newPassword
                                    }
                                    onChange={(e) =>
                                        setPasswordForm(
                                            (current) => ({
                                                ...current,
                                                newPassword:
                                                    e.target.value
                                            })
                                        )
                                    }
                                    required
                                />

                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() =>
                                        setShowNewPassword(
                                            (value) =>
                                                !value
                                        )
                                    }
                                >
                                    {showNewPassword
                                        ? t(
                                            'Hide',
                                            'লুকান'
                                        )
                                        : t(
                                            'Show',
                                            'দেখুন'
                                        )}
                                </button>

                            </div>

                            <div className="hint">
                                {t(
                                    'Minimum 8 characters. Use a strong, unique password.',
                                    'কমপক্ষে ৮ অক্ষর ব্যবহার করুন এবং একটি শক্তিশালী, আলাদা পাসওয়ার্ড দিন।'
                                )}
                            </div>

                        </div>

                        {/* CONFIRM PASSWORD */}

                        <div className="field">

                            <label htmlFor="confirmPassword">
                                {t(
                                    'Confirm new password',
                                    'নতুন পাসওয়ার্ড নিশ্চিত করুন'
                                )}
                            </label>

                            <div
                                style={{
                                    display: 'flex',
                                    gap: 8
                                }}
                            >

                                <input
                                    id="confirmPassword"
                                    type={
                                        showConfirmPassword
                                            ? 'text'
                                            : 'password'
                                    }
                                    autoComplete="new-password"
                                    minLength={8}
                                    value={
                                        passwordForm.confirmPassword
                                    }
                                    onChange={(e) =>
                                        setPasswordForm(
                                            (current) => ({
                                                ...current,
                                                confirmPassword:
                                                    e.target.value
                                            })
                                        )
                                    }
                                    required
                                />

                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() =>
                                        setShowConfirmPassword(
                                            (value) =>
                                                !value
                                        )
                                    }
                                >
                                    {showConfirmPassword
                                        ? t(
                                            'Hide',
                                            'লুকান'
                                        )
                                        : t(
                                            'Show',
                                            'দেখুন'
                                        )}
                                </button>

                            </div>

                            {
                                passwordForm.confirmPassword &&
                                passwordForm.newPassword !==
                                    passwordForm.confirmPassword && (

                                    <div
                                        className="hint"
                                        style={{
                                            marginTop: 6
                                        }}
                                    >
                                        {t(
                                            'Passwords do not match.',
                                            'পাসওয়ার্ড দুটি মিলছে না।'
                                        )}
                                    </div>

                                )
                            }

                        </div>

                    </div>

                    <div className="form-actions">

                        <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={passwordBusy}
                            onClick={() => {

                                setPasswordForm({
                                    currentPassword: '',
                                    newPassword: '',
                                    confirmPassword: ''
                                });

                                setPasswordError('');
                                setPasswordMessage('');

                                setShowCurrentPassword(false);
                                setShowNewPassword(false);
                                setShowConfirmPassword(false);
                            }}
                        >
                            {t(
                                'Clear',
                                'মুছুন'
                            )}
                        </button>

                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={
                                passwordBusy ||
                                !passwordForm.currentPassword ||
                                !passwordForm.newPassword ||
                                !passwordForm.confirmPassword ||
                                passwordForm.newPassword !==
                                    passwordForm.confirmPassword
                            }
                        >
                            {
                                passwordBusy
                                    ? t(
                                        'Changing password…',
                                        'পাসওয়ার্ড পরিবর্তন হচ্ছে…'
                                    )
                                    : t(
                                        'Change password',
                                        'পাসওয়ার্ড পরিবর্তন করুন'
                                    )
                            }
                        </button>

                    </div>

                </form>

            </section>

        </div>
    );
}
