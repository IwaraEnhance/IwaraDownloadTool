/* 自动生成 */
import en from './i18n/en.json';
import ja from './i18n/ja.json';
import zh_cn from './i18n/zh_cn.json';
export const i18nList = {
    en: en,
    ja: ja,
    zh: zh_cn,
} satisfies Record<string, I18N>;
export type Language = keyof typeof i18nList;