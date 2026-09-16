import { Segmented } from 'antd'
import type { ReactNode } from 'react'

/**
 * 分段选择器。
 *
 * 用途（文档 8.6）：主题模式（跟随系统 / 浅色 / 深色）、工作区切换等二选一场景。
 *
 * API 依据（antd 6.6.2，见 docs/13-组件API参考.md）：
 * - `SegmentedProps<ValueType>` 是**泛型**的，值为 string | number 联合；
 * - `options` 每项可为裸值，或 `{ label, value, icon?, tooltip? }`；
 * - `block` 控制是否占满父容器宽度；
 * - 选中态背景来自组件级 token `itemSelectedBg`（已在 antdTheme.ts 映射为 surface.raised）。
 */
export type SegmentedValue = string | number

export interface SegmentedOption<T extends SegmentedValue> {
  value: T
  label: ReactNode
  icon?: ReactNode
  /** 悬浮说明 */
  tooltip?: string
  disabled?: boolean
}

export interface SegmentedProps<T extends SegmentedValue> {
  value: T
  /** 值变化回调。收敛为纯值，调用方不必处理原生事件。 */
  onChange: (value: T) => void
  options: ReadonlyArray<SegmentedOption<T> | T>
  /** 占满父容器宽度，默认 true（设置页里的模式选择应是整行） */
  block?: boolean
  size?: 'small' | 'middle' | 'large'
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/** 判断选项是裸值还是对象形式 */
function isRichOption<T extends SegmentedValue>(
  option: SegmentedOption<T> | T
): option is SegmentedOption<T> {
  return typeof option === 'object' && option !== null && 'value' in option
}

export function SegmentedControl<T extends SegmentedValue>({
  value,
  onChange,
  options,
  block = true,
  size,
  disabled,
  className,
  ...aria
}: SegmentedProps<T>): JSX.Element {
  const normalized = options.map((option) =>
    isRichOption(option)
      ? {
          value: option.value,
          label: option.label,
          icon: option.icon,
          tooltip: option.tooltip,
          disabled: option.disabled
        }
      : { value: option, label: String(option) }
  )

  return (
    <Segmented<T>
      value={value}
      // antd 的回调签名是 (value: SegmentedValue)，这里收敛到泛型 T
      onChange={(next) => onChange(next as T)}
      options={normalized}
      block={block}
      size={size}
      disabled={disabled}
      className={className}
      aria-label={aria['aria-label']}
    />
  )
}
