import type { ThemeMode } from '@shared/themePreferences'
import { THEME_MODE_LABELS } from '@shared/themePreferences'
import { Icon } from './icons'
import previewSystem from '../../assets/theme/theme-system.png'
import previewLight from '../../assets/theme/theme-light.png'
import previewDark from '../../assets/theme/theme-dark.png'

/**
 * 主题模式卡片（对齐 Codex 的「外观」页）。
 *
 * 结构与视觉约定（逐轮与用户确认）：
 * - **缩略图铺满整个可点区域**：card 自身不加内边距、不设边框，
 *   高亮/选中态直接作用在图片所在的那一层，图片边缘即高亮区边缘；
 * - **文字在卡片之外**：标签与对勾位于图片下方，不属于高亮区域；
 *   hover 时只有图片区块高亮，不会把文字一起"染色"成一块；
 * - 选中态用强调色描边 + 对勾表达（不是背景高亮）。
 *
 * 缩略图使用设计提供的位图资源，而不是自绘色块：
 * 图中层级、圆角与明暗关系由设计稿确定，自绘难以还原。
 * 取舍：位图是静态的，不随用户自定义背景/强调色变化。
 */

const MODES: ThemeMode[] = ['system', 'light', 'dark']

/** 模式 → 缩略图资源 */
const PREVIEW_IMAGE: Record<ThemeMode, string> = {
  system: previewSystem,
  light: previewLight,
  dark: previewDark
}

export interface ThemeModeCardsProps {
  /** 用户选择的模式 */
  value: ThemeMode
  onChange: (mode: ThemeMode) => void
  /**
   * 系统当前是否为深色。
   *
   * 说明：卡片不再把「当前实际生效」写进界面（用户要求去掉），
   * 但该字段保留为组件的公开契约，调用方仍可传入。
   */
  systemDark: boolean
  disabled?: boolean
}

export function ThemeModeCards({
  value,
  onChange,
  systemDark: _systemDark,
  disabled = false
}: ThemeModeCardsProps): JSX.Element {
  return (
    <div role="radiogroup" aria-label="主题模式" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {MODES.map((item) => {
        const selected = item === value
        const label = THEME_MODE_LABELS[item]
        return (
          <button
            key={item}
            type="button"
            role="radio"
            /* 显式名称：避免与卡片内的其他文本拼成歧义名称 */
            aria-label={`主题模式：${label}`}
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(item)}
            className={[
              'group flex flex-col gap-2 text-left',
              disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
            ].join(' ')}
          >
            {/*
             * 缩略图层 = 可点区域：不加内边距，图片铺满；
             * hover / 选中态都作用在这一层，图片边缘就是高亮边缘。
             */}
            <span
              className={[
                'block overflow-hidden rounded-lg border transition-colors',
                selected
                  ? 'border-accent'
                  : 'border-transparent group-hover:border-border-strong'
              ].join(' ')}
            >
              <img
                src={PREVIEW_IMAGE[item]}
                alt=""
                aria-hidden="true"
                /* 16:9 设计稿；object-cover 保证卡片尺寸变化时不变形 */
                className="block aspect-video w-full object-cover"
                draggable={false}
              />
            </span>

            {/* 文字在可点区域之外，hover 不会把它一起高亮 */}
            <span className="flex items-center justify-center gap-1.5 text-[14px] text-txt-primary">
              {label}
              {selected && <Icon.Check size={14} className="text-accent" />}
            </span>
          </button>
        )
      })}
    </div>
  )
}
