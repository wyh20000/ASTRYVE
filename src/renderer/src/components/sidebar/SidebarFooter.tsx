import { useEffect, useState } from 'react'
import { useUiStore } from '../../stores/uiStore'
import { IconButton } from '../ui'
import { Icon } from '../ui/icons'

/** 侧栏底部：账号标识 + 设置入口 */
export default function SidebarFooter(): JSX.Element {
  const openSettings = useUiStore((s) => s.openSettings)
  const [accountId, setAccountId] = useState('')
  useEffect(() => {
    void window.agent.auth.status().then((result) => {
      if (result.ok && result.data.state === 'authenticated') setAccountId(result.data.userId ?? '')
    })
  }, [])

  return (
    <div className="mt-auto border-t border-border-subtle">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[14px] font-semibold text-accent-contrast">
          {accountId ? accountId[0].toUpperCase() : 'A'}
        </div>
        <span className="text-[14px] text-txt-primary">
          {accountId ? `账号 ${accountId.slice(0, 8)}` : '当前账号'}
        </span>
        <span className="ml-auto">
          <button className="mr-2 text-xs text-txt-muted hover:text-txt-primary" type="button" onClick={() => void window.agent.auth.logout()}>退出登录</button>
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
