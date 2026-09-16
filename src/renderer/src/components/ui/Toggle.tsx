import { Switch, Tag } from 'antd'
import type { ReactNode } from 'react'

/**
 * 开关与标签。
 *
 * API 依据（antd 6.6.2，见 docs/13-组件API参考.md）：
 * - `SwitchProps.size` 类型为 `Exclude<SizeType, 'large'> | 'default'`，
 *   即 **不接受 'large'**；
 * - `SwitchProps` 同时提供 `checked/defaultChecked` 与 `value/defaultValue` 两套受控名；
 * - `TagProps.variant` 取值为 `'filled' | 'solid' | 'outlined'`，
 *   颜色可用预设名（如 'success'）或自定义 hex。
 */

/* ---------------- Switch ---------------- */

export type SwitchSize = 'small' | 'default'

export interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  size?: SwitchSize
  loading?: boolean
  /** 开启/关闭时显示在开关内部的文字 */
  checkedChildren?: ReactNode
  unCheckedChildren?: ReactNode
  className?: string
  'aria-label'?: string
}

/**
 * 开关。
 *
 * 说明：antd 的 onChange 签名是 `(checked, event) => void`，
 * 这里收敛为 `(checked: boolean) => void`，与项目内其他控件一致。
 */
export function ToggleSwitch({
  checked,
  onChange,
  disabled,
  size,
  loading,
  checkedChildren,
  unCheckedChildren,
  className,
  ...aria
}: ToggleSwitchProps): JSX.Element {
  return (
    <Switch
      checked={checked}
      onChange={(next) => onChange(next)}
      disabled={disabled}
      size={size}
      loading={loading}
      checkedChildren={checkedChildren}
      unCheckedChildren={unCheckedChildren}
      className={className}
      aria-label={aria['aria-label']}
    />
  )
}

/* ---------------- Tag ---------------- */

export type TagTone = 'neutral' | 'accent' | 'success' | 'warning' | 'error' | 'info'

export interface TagChipProps {
  children: ReactNode
  /** 语义色调，默认 neutral */
  tone?: TagTone
  /** 视觉变体，默认 outlined（低噪声） */
  variant?: 'filled' | 'solid' | 'outlined'
  /** 可关闭时提供回调 */
  onClose?: () => void
  icon?: ReactNode
  className?: string
}

/** 语义色调 → antd 预设色名。使用预设名而非 hex，便于 antd 生成配套的前景/边框色。 */
const TONE_COLOR: Record<TagTone, string | undefined> = {
  neutral: undefined,
  accent: 'blue',
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'processing'
}

/**
 * 标签。
 *
 * 设计约束：语义由 `tone` 表达，调用方不直接写颜色；
 * 这样后续调整状态色只需改令牌，不需要逐页改 className。
 */
export function TagChip({
  children,
  tone = 'neutral',
  variant = 'outlined',
  onClose,
  icon,
  className
}: TagChipProps): JSX.Element {
  return (
    <Tag
      color={TONE_COLOR[tone]}
      variant={variant}
      closable={onClose ? true : undefined}
      onClose={onClose}
      icon={icon}
      className={className}
    >
      {children}
    </Tag>
  )
}
