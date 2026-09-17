import { Tooltip } from 'antd'
import type { ReactNode } from 'react'

/**
 * 图标按钮。
 *
 * 设计约束（文档第 6、8.1 节）：
 * - 统一 32px 点击区域（跟随令牌 --space-control），不做「视觉 16px、热区 16px」；
 * - 必须有可访问名称：没有可见文字时 `label` 必填，同时用于 Tooltip；
 * - 图标线宽一致：调用方传入的 Icon 组件统一使用 strokeWidth 2；
 * - 提供 aria-pressed / aria-expanded，避免用颜色单独表达选中态。
 */

export type IconButtonSize = 'sm' | 'md'

export interface IconButtonProps {
  /** 图标元素 */
  icon: ReactNode
  /** 可访问名称；同时作为 Tooltip 文案。图标按钮必填。 */
  label: string
  /** 点击回调 */
  onClick?: (event: React.MouseEvent<HTMLElement>) => void
  /** 尺寸：sm=28px（令牌 controlHeightSM），md=32px（令牌 controlHeight） */
  size?: IconButtonSize
  /** 当前处于选中/激活态 */
  active?: boolean
  disabled?: boolean
  /** 危险操作（如删除）使用错误色 */
  danger?: boolean
  /** 是否禁用 Tooltip（例如已在别处展示文案） */
  hideTooltip?: boolean
  /**
   * 挂载后自动聚焦。
   * 用于弹层/抽屉的关闭按钮：打开即把焦点交给它，键盘用户可以立刻退出，
   * 也让焦点永远落在弹层内部（配合上层焦点陷阱）。
   */
  autoFocus?: boolean
  className?: string
  'aria-expanded'?: boolean
  'aria-pressed'?: boolean
}

export function IconButton({
  icon,
  label,
  onClick,
  size = 'md',
  active = false,
  disabled = false,
  danger = false,
  hideTooltip = false,
  autoFocus = false,
  className,
  ...aria
}: IconButtonProps): JSX.Element {
  const dimension = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'

  const button = (
    <button
      type="button"
      aria-label={label}
      aria-pressed={aria['aria-pressed'] ?? (active ? true : undefined)}
      aria-expanded={aria['aria-expanded']}
      disabled={disabled}
      autoFocus={autoFocus}
      onClick={onClick}
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors',
        dimension,
        // 选中态用背景 + 文字色共同表达，不单独依赖颜色
        active
          ? 'bg-bg-active text-txt-primary'
          : danger
            ? 'text-txt-secondary hover:bg-bg-raised hover:text-err'
            : 'text-txt-secondary hover:bg-bg-raised hover:text-txt-primary',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className ?? ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon}
    </button>
  )

  if (hideTooltip) return button

  return (
    <Tooltip title={label} mouseEnterDelay={0.4}>
      {/* disabled 的 button 不触发鼠标事件，包一层 span 让 Tooltip 仍可用 */}
      <span className="inline-flex">{button}</span>
    </Tooltip>
  )
}
