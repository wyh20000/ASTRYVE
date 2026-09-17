import { useUiStore } from '../../stores/uiStore'
import { IconButton } from '../ui'
import { Icon } from '../ui/icons'

/** 侧栏底部：账号标识 + 设置入口 */
export default function SidebarFooter(): JSX.Element {
  const openSettings = useUiStore((s) => s.openSettings)

  return (
    <div className="mt-auto border-t border-border-subtle">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[14px] font-semibold text-accent-contrast">
          M
        </div>
        <span className="text-[14px] text-txt-primary">
          myh <span className="text-txt-muted">Pro</span>
        </span>
        <span className="ml-auto">
          <IconButton
            icon={<Icon.Settings size={15} />}
            label="打开设置"
            onClick={openSettings}
          />
        </span>
      </div>
    </div>
  )
}
