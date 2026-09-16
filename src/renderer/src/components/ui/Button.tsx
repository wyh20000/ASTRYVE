import type { ButtonProps as AntdButtonProps } from 'antd'
import { Button as AntdButton } from 'antd'
import type { ReactNode } from 'react'

/**
 * 语义按钮。
 *
 * 设计约束（文档第 6 节）：
 * - 只暴露项目真正需要的语义属性，不二次复制 Ant Design 的完整 API；
 * - 尺寸与配色全部来自令牌（由 App 的 ConfigProvider 注入），
 *   组件自身不写死 HEX、字号或控件高度；
 * - 危险操作必须有独立语义，不能只靠红色文字表达。
 *
 * 与旧的 `.btn` 工具类的关系：
 * 阶段 B 期间两者并存。`.btn` 由未迁移组件继续使用，二者共享同一批令牌，
 * 因此外观一致；阶段 E 清理 `.btn`。
 */

export type ButtonVariant = 'primary' | 'default' | 'text' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps {
  children?: ReactNode
  /** 语义类型，默认 default */
  variant?: ButtonVariant
  /**
   * 尺寸。不传时使用 Provider 的默认控件高度（令牌 controlHeight）；
   * 传 sm 使用小号。
   */
  size?: ButtonSize
  /** 加载中：自动禁用点击并显示指示器 */
  loading?: boolean
  disabled?: boolean
  /** 图标，渲染在文字之前 */
  icon?: ReactNode
  /** 图标渲染在文字之后（如「展开」箭头） */
  suffix?: ReactNode
  /** 占满父容器宽度 */
  block?: boolean
  /** 原生 button 的 type，默认 button（避免误触发表单提交） */
  htmlType?: 'button' | 'submit' | 'reset'
  /** 原生 title，作为 Tooltip 的轻量替代 */
  title?: string
  className?: string
  style?: React.CSSProperties
  /** 无障碍标签，图标按钮必填 */
  'aria-label'?: string
  'aria-expanded'?: boolean
  'aria-pressed'?: boolean
  onClick?: (event: React.MouseEvent<HTMLElement>) => void
}

/**
 * 语义类型 → Ant Design 按钮属性的映射。
 *
 * size 不在这里填充：只有调用方显式传了 size 才下发，
 * 否则 ConfigProvider / XProvider 的 componentSize 会被这里覆盖掉。
 */
function toAntdProps(variant: ButtonVariant, size?: ButtonSize): Partial<AntdButtonProps> {
  const common: Partial<AntdButtonProps> = {
    ...(size ? { size: size === 'sm' ? 'small' : 'middle' } : {})
  }
  switch (variant) {
    case 'primary':
      return { ...common, type: 'primary' }
    case 'danger':
      // 危险操作走独立语义：主色红 + 明确的危险态，而不是「红色文字」
      return { ...common, danger: true }
    case 'text':
      return { ...common, type: 'text' }
    case 'default':
    default:
      return { ...common, type: 'default' }
  }
}

export function Button({
  children,
  variant = 'default',
  size,
  loading = false,
  disabled = false,
  icon,
  suffix,
  block = false,
  htmlType = 'button',
  title,
  className,
  style,
  onClick,
  ...aria
}: ButtonProps): JSX.Element {
  const antd = toAntdProps(variant, size)

  return (
    <AntdButton
      {...antd}
      block={block}
      loading={loading}
      disabled={disabled}
      icon={icon}
      htmlType={htmlType}
      title={title}
      className={className}
      style={style}
      onClick={onClick}
      /*
       * 关闭 Ant Design 的「两个汉字之间自动插空格」。
       * 中文界面下它会把按钮文案变成「保 存」，
       * 与设计文档 4.3「中文不使用过宽字距」冲突。
       */
      autoInsertSpace={false}
      aria-label={aria['aria-label']}
      aria-expanded={aria['aria-expanded']}
      aria-pressed={aria['aria-pressed']}
    >
      {/* suffix 用 span 包裹，保证与文字基线对齐 */}
      {suffix ? (
        <>
          {children}
          <span className="inline-flex items-center">{suffix}</span>
        </>
      ) : (
        children
      )}
    </AntdButton>
  )
}
