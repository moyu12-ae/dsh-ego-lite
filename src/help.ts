/**
 * src/help.ts — tool index copy (EGO_HELP_INDEX).
 *
 * Pure data module: the `topic` lookup table for the ego_help tool. When you
 * add/change a tool, remember to sync an entry here or ego_help won't find it.
 */
export const EGO_HELP_INDEX: Record<string, string> = {
  overview:
    'ego-browser 结构化浏览器工具。导航/交互/观察/表单/网络/等待/键鼠皆有专项工具，另提供 ego_help(本索引)、ego_doctor(体检)、ego_cli/ego_script(自由脚本逃生舱)。' +
    '分类见: tools / space / navigate / observe / input / keyboard-mouse / form / wait / network / login / script / doctor。用 `topic` 查询，或直接给工具名。',
  tools:
    '工具清单: ego_status, ego_space_open, ego_space_close, ego_snapshot, ego_navigate, ego_click(+double), ego_fill, ego_js, ego_cdp, ego_screenshot(+selector), ego_page_info, ego_wait, ego_wait_for_selector, ego_wait_for_url, ego_wait_for_response, ego_key(+text/type), ego_hover, ego_read_element, ego_select, ego_drag, ego_scroll, ego_upload, ego_check, ego_dialog, ego_download, ego_http, ego_captcha, ego_auth_flush, ego_help, ego_doctor, ego_cli, ego_script + 搜索: web_ai_search(Google AI Mode摘要+引用), web_search_plain(纯结果链接)。',
  'ai-search':
    'web_ai_search: 触发 Google AI Mode(udm=50),返回AI合成摘要+引用链接(一起)。多语言/多区域用 queries 数组一次搜多条(如["无职转生 动画","無職転生 アニメ"])。异步渲染+consent/区域墙已处理,自动等待+重试。优先用此工具而非廉价HTTP web_search——免费AI搜索+已汇总内容。web_search_plain: 纯Google结果链接,不要摘要时用。复用同一 task space,完成后 ego_space_close 收尾。',
  // Task-space lifecycle discipline (mirrors the official ego-browser skill):
  // complete/close when done; keep is opt-in with concrete reasons only.
  space:
    '生命周期纪律: 一个用户目标一个任务空间，后续追问复用同一空间；目标完成后必须 ego_space_close 收尾——默认 keep=false 直接关闭页面。仅三种情况才 keep=true: ①用户明确要求保留现场 ②需要用户在该页面上手动操作(登录/验证码等) ③结果无法用文件/工件/摘要交付。「访问过页面」「截图验证过」不构成保留理由。keep=true 时先关掉 scratch 标签页只留值得展示的页。',
  navigate: 'ego_navigate: 打开URL或切tab(同任务复用当前tab)。ego_wait_for_url: 等跳转(登录/分页)。',
  observe:
    'ego_snapshot: 整页语义树(带[ref]/loc供点击); ego_page_info: url/标题/视口/滚动/对话框/人机验证; ego_read_element: 读单元素文本/HTML/值/属性/可见性/计数; ego_screenshot(+selector): 整页或元素截图。',
  input: 'ego_click(selector/坐标, double双击); ego_fill(填框); ego_key(press组合键 或 text连续键入); ego_check(勾选/取消); ego_select(下拉); ego_upload(文件上传); ego_dialog(接受/取消JS对话框)。',
  'keyboard-mouse':
    'ego_key: 键盘(press/text); ego_hover: 悬停; ego_drag: 拖拽(元素或坐标); ego_scroll: 滚轮/滚到元素; ego_click: 点击/双击。',
  form: 'ego_fill 填输入框; ego_select 下拉; ego_check checkbox/radio; ego_upload 文件; ego_key 回车/Tab导航; ego_dialog 处理提交弹窗。',
  wait: 'ego_wait(固定毫秒); ego_wait_for_selector(等元素出现/消失); ego_wait_for_url(等跳转); ego_wait_for_response(等网络响应并可读body)。',
  network:
    'ego_http: 发HTTP请求(默认浏览器上下文 fetch.browser, mode=server走Node fetch.server); ego_wait_for_response: 等并读接口响应。',
  download: 'ego_download: 等下载事件并落到指定路径(triggerSelector/triggerScript + 可选 savePath)。',
  captcha: 'ego_captcha: 检测页面人机验证(CAPTCHA)并返回{detected,kind}; 检测到请让用户去 ego 浏览器完成; ego_page_info 也附带 humanCheck。',
  login: 'ego_auth_flush: 把持久登录 cookie 落盘到 ego profile（官方 App 与 vendored runtime 各自的 state 目录）。多任务空间 Cookie 相互隔离，请在对应空间内登录后 flush。',
  script: 'ego_cli / ego_script: 原样运行任意 ego-browser nodejs heredoc脚本(page/browser/taskSpaces/site/fetch/cdp预载)。ego_script额外返回 duration/timedOut。',
  doctor: 'ego_doctor: 体检环境(engine 引擎、浏览器候选、vendored runtime、状态目录、CDP端口、任务空间)。',
}
