import { Select } from 'antd'
import type { ReactNode } from 'react'

/**
 * 下拉选择器。
 *
 * 用途：模型选择、推理等级、Skill 来源筛选、工作区选择等。
 *
 * API 依据（antd 6.6.2，见 docs/13-组件API参考.md）：
 * - `SelectProps<ValueType, OptionType>` 为泛型，`options` 接受
 *   `{ value, label, disabled?, title? }` 数组；
 * - 弹层容器与阴影由 Provider token 统一控制，组件内不写死；
 * - `variant` / `status` 用于错误态与无边框样式。
 */
export type SelectValue = string | number

export interface SelectOption<T extends SelectValue> {
  value: T
  label: ReactNode
  disabled?: boolean
  /** 原生 title，用于长文本省略后的完整提示 */
  title?: string
}

export interface SelectControlProps<T extends SelectValue> {
  value: T | undefined
  onChange: (value: T) => void
  options: ReadonlyArray<SelectOption<T>>
  placeholder?: string
  disabled?: boolean
  /** 允许清空，默认 false（model / 等级这类必选项不应为空） */
  allowClear?: boolean
  /** 占满父容器宽度 */
  block?: boolean
  size?: 'small' | 'middle' | 'large'
  /** 错误态 */
  status?: 'error' | 'warning'
  /** 无边框（用于工具条内嵌场景） */
  variant?: 'outlined' | 'borderless' | 'filled'
  className?: string
  /** 下拉弹层是否挂载到 body；窄容器内建议 true 以免被裁剪 */
  getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement
  'aria-label'?: string
}

export function SelectControl<T extends SelectValue>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  allowClear = false,
  block = false,
  size,
  status,
  variant,
  className,
  getPopupContainer,
  ...aria
}: SelectControlProps<T>): JSX.Element {
  return (
    <Select<T>
      value={value}
      onChange={(next) => onChange(next as T)}
      options={options as never}
      placeholder={placeholder}
      disabled={disabled}
      allowClear={allowClear}
      size={size}
      status={status}
      variant={variant}
      className={className}
      getPopupContainer={getPopupContainer}
      style={block ? { width: '100%' } : undefined}
      aria-label={aria['aria-label']}
    />
  )
}
