/**
 * 全局 UI 组件层（阶段 B）。
 *
 * 业务页面应从这里引用通用控件，而不是直接使用原生 button/input
 * 或散装 Ant Design 组件。详见 docs/11-全应用视觉系统升级设计.md 第 6 节。
 *
 * 迁移约定：全局组件只负责外观与交互基元，业务事件参数保持原样透传，
 * 因此替换展示组件时不需要改动 store、IPC 或 handler。
 *
 * 组件 API 依据统一记录在 docs/13-组件API参考.md。
 */

export { Button } from './Button'
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button'

export { IconButton } from './IconButton'
export type { IconButtonProps, IconButtonSize } from './IconButton'

export { SearchInput, TextArea, TextInput } from './Input'
export type { MultilineInputProps, SearchInputProps, TextInputProps } from './Input'

export { FormSection, SettingRow } from './FormSection'
export type { FormSectionProps, SettingRowProps } from './FormSection'

export { SegmentedControl } from './Segmented'
export type { SegmentedOption, SegmentedProps, SegmentedValue } from './Segmented'

export { SelectControl } from './Select'
export type { SelectControlProps, SelectOption, SelectValue } from './Select'

export { ThemeModeCards } from './ThemeModeCards'
export type { ThemeModeCardsProps } from './ThemeModeCards'

export { TagChip, ToggleSwitch } from './Toggle'
export type { SwitchSize, TagChipProps, TagTone, ToggleSwitchProps } from './Toggle'

export { EmptyState, SkeletonLines } from './EmptyState'
export type { EmptyStateProps, SkeletonLinesProps } from './EmptyState'

export { Icon } from './icons'
