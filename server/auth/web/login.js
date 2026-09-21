const root = document.getElementById('login-root')
const requestId = root.dataset.requestId
const csrf = root.dataset.csrf
const status = document.getElementById('status')
const phone = document.getElementById('phone')
const code = document.getElementById('code')
const send = document.getElementById('send-code')
const submit = document.getElementById('submit-login')
const qq = document.getElementById('qq')
const wechat = document.getElementById('wechat')
let countdown

function show(message, error = false) {
  status.textContent = message
  status.classList.toggle('error', error)
}

async function post(path, body) {
  const result = await fetch(path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ ...body, requestId })
  })
  const payload = await result.json()
  if (!result.ok) throw new Error(payload.error || '请求失败，请稍后重试')
  return payload
}

function normalizedPhone() {
  const digits = phone.value.replace(/[\s-]/g, '')
  if (!/^1[3-9]\d{9}$/.test(digits)) throw new Error('请输入正确的中国大陆手机号')
  return `+86${digits}`
}

send.addEventListener('click', async () => {
  try {
    send.disabled = true
    show('正在发送验证码…')
    await post('/v1/auth/sms/request', { phone: normalizedPhone() })
    let remaining = 60
    send.textContent = `${remaining} 秒后重试`
    countdown = setInterval(() => {
      remaining--
      send.textContent = remaining > 0 ? `${remaining} 秒后重试` : '获取验证码'
      if (remaining <= 0) { clearInterval(countdown); send.disabled = false }
    }, 1000)
    show('验证码已发送，请查看短信')
  } catch (error) { show(error.message, true); send.disabled = false }
})

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  try {
    submit.disabled = true
    show('正在验证…')
    const payload = await post('/v1/auth/sms/verify', { phone: normalizedPhone(), code: code.value })
    show('验证成功，正在返回客户端…')
    window.location.replace(payload.redirectUrl)
  } catch (error) { show(error.message, true); submit.disabled = false }
})

for (const [button, provider] of [[qq, 'qq'], [wechat, 'wechat']]) {
  button.addEventListener('click', async () => {
    try {
      button.disabled = true
      show('正在前往授权页面…')
      const payload = await post('/v1/auth/oauth/start', { provider })
      const target = new URL(payload.authorizeUrl)
      const expected = provider === 'qq' ? 'https://graph.qq.com' : 'https://open.weixin.qq.com'
      if (target.origin !== expected) throw new Error('授权地址无效')
      window.location.assign(target.toString())
    } catch (error) { show(error.message, true); button.disabled = false }
  })
}

fetch('/v1/auth/methods', { cache: 'no-store' }).then((result) => result.json()).then((methods) => {
  send.disabled = !methods.phone
  submit.disabled = !methods.phone
  qq.disabled = !methods.qq
  wechat.disabled = !methods.wechat
  if (!methods.phone && !methods.qq && !methods.wechat) show('登录方式尚未配置，请稍后再试', true)
}).catch(() => show('认证服务暂时不可用', true))

function initStarfield() {
  const canvas = document.getElementById('starfield')
  const context = canvas?.getContext('2d')
  if (!context) return
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let stars = []
  let width = 0
  let height = 0
  let pointer = null
  let frame = 0

  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 2)
    width = window.innerWidth
    height = window.innerHeight
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    context.setTransform(scale, 0, 0, scale, 0, 0)
    const count = Math.min(320, Math.max(140, Math.round(width * height / 4500)))
    stars = Array.from({ length: count }, () => {
      const x = Math.random() * width
      const y = Math.random() * height
      return { x, y, homeX: x, homeY: y, vx: 0, vy: 0,
        radius: .4 + Math.random() * 1.3, alpha: .23 + Math.random() * .65 }
    })
    if (reducedMotion.matches) draw()
  }

  function draw() {
    context.clearRect(0, 0, width, height)
    for (const star of stars) {
      if (!reducedMotion.matches) {
        let pushX = 0
        let pushY = 0
        if (pointer) {
          const dx = star.x - pointer.x
          const dy = star.y - pointer.y
          const distance = Math.hypot(dx, dy)
          if (distance > 0 && distance < 150) {
            const force = (1 - distance / 150) * 2.3
            pushX = dx / distance * force
            pushY = dy / distance * force
          }
        }
        star.vx = (star.vx + (star.homeX - star.x) * .012 + pushX) * .86
        star.vy = (star.vy + (star.homeY - star.y) * .012 + pushY) * .86
        star.x += star.vx
        star.y += star.vy
      }
      context.beginPath()
      context.fillStyle = 'rgba(215,232,255,' + star.alpha + ')'
      context.arc(star.x, star.y, star.radius, 0, Math.PI * 2)
      context.fill()
    }
    if (!reducedMotion.matches && !document.hidden) frame = requestAnimationFrame(draw)
  }

  window.addEventListener('pointermove', (event) => {
    pointer = { x: event.clientX, y: event.clientY }
  }, { passive: true })
  window.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) pointer = null
  })
  window.addEventListener('resize', resize, { passive: true })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(frame)
    else if (!reducedMotion.matches) { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw) }
  })
  reducedMotion.addEventListener('change', () => {
    cancelAnimationFrame(frame)
    draw()
  })
  resize()
  if (!reducedMotion.matches) frame = requestAnimationFrame(draw)
}

initStarfield()
