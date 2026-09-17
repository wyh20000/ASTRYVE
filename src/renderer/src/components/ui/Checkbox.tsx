import { Checkbox as AntCheckbox } from 'antd'
import type { ReactNode } from 'react'

/**
 * 复选框。
 *
 * API 依据（antd 6.6.2，见 docs/13-组件API参考.md）：
 * - `CheckboxProps.onChange` 的签名是 `(e: CheckboxChangeEvent) => void`，
 *   勾选状态在 `e.target.checked`；这里收敛为 `(checked: boolean) => void`；
 * - antd 的 Checkbox 渲染结构是 `label > (input + span.ant-checkbox-label)`，
 *   即 **点文字也能切换**（原生 label 关联 input）。
 *   这一点必须保留：全局的 `Switch` 渲染的是 `<button>`，
 *   换成它会让「点文字切换」失效（见 docs/12 下一步第 1 条）。
 */

export interface CheckboxProps {
  checked: boolean
  /** 收敛为布尔值，与项目内其他控件一致 */
  onChange: (checked: boolean) => void
  /** 同时作为可访问名称（antd 会渲染成 label 文本） */
  children?: ReactNode
  disabled?: boolean
  className?: string
}

export function Checkbox({ checked, onChange, children, disabled, className }: CheckboxProps): JSX.Element {
  return (
    <AntCheckbox
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      className={className}
    >
      {children}
    </AntCheckbox>
  )
}
