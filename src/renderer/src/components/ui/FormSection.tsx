import type { ReactNode } from 'react'

/**
 * 设置页布局原语（文档第 6、8.6 节）。
 *
 * 目的：消除设置页里重复出现的「标题 + 说明 + 右侧控件」三件套。
 * 迁移前 SettingsPage.tsx 用本地 Group/Label/Field 三个函数反复拼装，
 * 这里把它们提升为全局组件，窄窗口下自动改为上下排列。
 */

export interface FormSectionProps {
  /** 分区标题，使用 16px 层级 */
  title: string
  /** 分区说明，弱化颜色，不承载关键信息 */
  description?: ReactNode
  children: ReactNode
  /** 标题右侧的附加操作（如「恢复默认」） */
  extra?: ReactNode
  className?: string
}

export function FormSection({
  title,
  description,
  children,
  extra,
  className
}: FormSectionProps): JSX.Element {
  return (
        <section
      className={[
        /*
         * mt-5：设置页的页面标题(<h1>)与紧随其后的分区标题之间需要留白。
         * 实测曾经 gap 为 0，两个标题贴在一起，看起来像样式错乱。
         */
        'mt-5 mb-5',
        className ?? ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-medium leading-6 text-txt-primary">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[14px] leading-[22px] text-txt-muted">{description}</p>
          ) : null}
        </div>
        {extra ? <div className="shrink-0">{extra}</div> : null}
      </div>
      <div className="rounded-lg border border-border-subtle bg-bg-raised p-3.5">{children}</div>
    </section>
  )
}

export interface SettingRowProps {
  /** 设置项名称 */
  label: string
  /** 设置项说明，可为空 */
  description?: ReactNode
  /** 右侧控件 */
  children: ReactNode
  /** 控件是否占满整行（用于输入框、文本域等宽控件） */
  block?: boolean
  /**
   * 布局模式：
   * - inline（默认）：名称在左、控件在右，适合开关/按钮这类窄控件；
   * - stacked：名称在上、控件在下，适合输入框/文本域这类宽控件的表单。
   *
   * inline 在宽窗口下会让「标签—控件」的间距随标签长度变化而不齐，
   * 表单里会显得松散；stacked 的对齐更稳定。
   */
  layout?: 'inline' | 'stacked'
  /** 是否隐藏分隔线上的上边距（用于分组首行） */
  first?: boolean
  className?: string
}

/**
 * 单个设置行：左侧名称与说明，右侧控件。
 *
 * 窄窗口（< 720px）自动从横向改为纵向排列，
 * 而不是把文字缩小 —— 符合文档第 9 节的响应式约束。
 */
export function SettingRow({
  label,
  description,
  children,
  block = false,
  layout = 'inline',
  first = false,
  className
}: SettingRowProps): JSX.Element {
  const stacked = layout === 'stacked'
  return (
    <div
      className={[
        stacked
          ? 'flex flex-col gap-1.5 py-2.5'
          : 'flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4',
        first ? '' : 'border-t border-border-subtle',
        className ?? ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={stacked ? 'min-w-0' : 'min-w-0 sm:flex-1'}>
        <div className="text-[14px] leading-[22px] font-medium text-txt-primary">{label}</div>
        {description ? (
          <div className="mt-0.5 text-[14px] leading-[22px] text-txt-muted">{description}</div>
        ) : null}
      </div>
      <div
        className={
          stacked ? 'w-full' : block ? 'w-full sm:max-w-[320px]' : 'shrink-0'
        }
      >
        {children}
      </div>
    </div>
  )
}
