import type { ReactNode } from 'react'

/**
 * 空状态与加载占位。
 *
 * 与 antd `Empty` 的区别：本项目不用它的默认插画（风格与产品不符），
 * 改为「图标 + 主文案 + 次要说明 + 可选操作」的克制布局。
 * 遵守设计文档 4.2：主文案 16px，说明 14px，不出现 13px 以下文字。
 */

export interface EmptyStateProps {
  /** 主文案，使用 16px 层级 */
  title: string
  /** 次要说明，14px 弱化色，不承载关键信息 */
  description?: ReactNode
  /** 图标元素；不传则不渲染图标区 */
  icon?: ReactNode
  /** 建议操作，通常是一个 Button */
  action?: ReactNode
  /** 紧凑模式，用于侧栏等窄区域 */
  compact?: boolean
  className?: string
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
  className
}: EmptyStateProps): JSX.Element {
  return (
    <div
      role="status"
      className={[
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-3 py-6' : 'gap-3 px-4 py-16',
        className ?? ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon ? (
        <div
          className={[
            'flex items-center justify-center rounded-full bg-bg-raised text-txt-muted',
            compact ? 'h-9 w-9' : 'h-12 w-12'
          ].join(' ')}
        >
          {icon}
        </div>
      ) : null}

      <div className="text-[16px] leading-6 text-txt-secondary">{title}</div>

      {description ? (
        <div className="max-w-[380px] text-[14px] leading-[22px] text-txt-muted">
          {description}
        </div>
      ) : null}

      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

export interface SkeletonLinesProps {
  /** 行数，默认 3 */
  lines?: number
  className?: string
  'aria-label'?: string
}

/**
 * 文本骨架屏。
 *
 * 用于会话加载、工作区文件列表等异步区域，避免切换时出现空白闪烁。
 * 宽度交替变化以贴近真实文本段落，最后一行较短。
 */
export function SkeletonLines({
  lines = 3,
  className,
  ...aria
}: SkeletonLinesProps): JSX.Element {
  const widths = ['100%', '92%', '78%', '96%', '84%']
  return (
    <div
      className={['space-y-2', className ?? ''].filter(Boolean).join(' ')}
      role="status"
      aria-busy="true"
      aria-label={aria['aria-label'] ?? '加载中'}
    >
      {Array.from({ length: Math.max(1, lines) }, (_, index) => (
        <div
          key={index}
          className="h-3.5 animate-pulse rounded bg-bg-active"
          style={{ width: index === lines - 1 ? '60%' : widths[index % widths.length] }}
        />
      ))}
    </div>
  )
}
