import { Input } from 'antd'
import type { InputProps } from 'antd'
import type { TextAreaProps } from 'antd/es/input'

/**
 * 输入类控件的统一封装。
 *
 * 设计约束（文档第 6、8.4 节）：
 * - 高度、字号、圆角、错误态、禁用态全部来自 Provider 令牌与 Ant Design 语义，
 *   组件自身不写死尺寸；
 * - 清空按钮、错误/禁用状态在三个组件里保持一致；
 * - 不改变业务事件参数：onChange 仍然透传原生事件，
 *   因此迁移时不需要改动 store 或调用方逻辑。
 *
 * 类型导入说明：antd 没有从根导出 TextAreaProps（只导出 InputProps），
 * 因此这里从 'antd/es/input' 取，与本仓库其他 antd 类型用法一致。
 */

export interface TextInputProps extends InputProps {
  /** 占满父容器宽度（默认由父容器决定） */
  block?: boolean
}

/** 单行输入。默认不显示计数，保持低噪声。 */
export function TextInput({ block, style, ...rest }: TextInputProps): JSX.Element {
  return (
    <Input
      allowClear={false}
      {...rest}
      style={block ? { ...style, width: '100%' } : style}
    />
  )
}

export interface MultilineInputProps extends TextAreaProps {
  /** 最小行数，默认 3 */
  minRows?: number
  /** 最大行数，超出后内部滚动（默认不限制） */
  maxRows?: number
}

/**
 * 多行输入。默认 3 行起，随内容增长。
 *
 * 关于 `rows` 与 `autoSize`：
 * - `@rc-component/input` 只从 `autoSize` 对象里读取 minRows/maxRows 来计算高度，
 *   顶层的 `minRows` 既不会生效，还会被透传到 DOM 触发 React 告警；
 * - 因此这里把行数同时写进 `rows`（真实 DOM 属性，定义初始高度）
 *   与 `autoSize`（驱动自动增长），两者取同一个值，语义一致。
 */
export function TextArea({
  minRows = 3,
  maxRows,
  autoSize,
  rows,
  ...rest
}: MultilineInputProps): JSX.Element {
  const lineCount = typeof rows === 'number' ? rows : minRows
  return (
    <Input.TextArea
      {...rest}
      rows={lineCount}
      autoSize={autoSize ?? { minRows: lineCount, maxRows }}
    />
  )
}

export interface SearchInputProps extends Omit<InputProps, 'onChange' | 'prefix'> {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** 是否显示清空按钮，默认显示 */
  allowClear?: boolean
  /** 无障碍标签 */
  'aria-label'?: string
}

/**
 * 搜索输入。
 *
 * 注意：onChange 在这里被收敛为 `(value: string) => void`，
 * 因为搜索框的调用方（侧栏、设置页搜索）只需要字符串。
 * 需要原生事件时请直接使用 TextInput。
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  allowClear = true,
  ...rest
}: SearchInputProps): JSX.Element {
  return (
    <Input
      {...rest}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      allowClear={allowClear}
    />
  )
}
