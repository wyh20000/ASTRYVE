import { useUiStore } from '../../stores/uiStore'
import { Icon } from '../ui/icons'

export default function SidebarFooter(): JSX.Element {
  const openSettings = useUiStore((s) => s.openSettings)

  return (
    <div className="mt-auto border-t border-border">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-white">
          M
        </div>
        <span className="text-[13px] text-txt-primary">
          myh <span className="text-txt-muted">Pro</span>
        </span>
        <button className="ml-auto btn-icon" title="设置" onClick={openSettings}>
          <Icon.Settings size={15} />
        </button>
      </div>
    </div>
  )
}