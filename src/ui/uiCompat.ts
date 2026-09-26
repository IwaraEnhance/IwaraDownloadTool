/**
 * UI 兼容 re-export（ui/ui.ts 拆分后的过渡层；引用方迁直连后可删）。
 * 实体：ui/menu.ts、ui/configPanel.ts、ui/widgets/{checkbox,watermark}.ts。
 */
export { menu } from './menu'
export { configEdit } from './configPanel'
export { injectCheckbox, uninjectCheckbox } from './widgets/checkbox'
export { waterMark } from './widgets/watermark'
