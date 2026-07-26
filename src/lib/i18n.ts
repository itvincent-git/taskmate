import type { Language } from "../types";

export const messages = {
  en: {
    appName: "Your App",
    home: "Home",
    settings: "Settings",
    logs: "Logs",
    templateReady: "Your desktop foundation is ready.",
    templateHint: "Run template:init once before shipping your application.",
    environment: "Runtime",
    environmentText: "Tauri 2 · React 19 · TypeScript",
    ipcTitle: "Rust IPC example",
    name: "Name",
    greet: "Send greeting",
    greetingPlaceholder: "Enter a name",
    language: "Language",
    autostart: "Launch at login",
    autostartHint: "Start quietly in the system tray.",
    updates: "Application updates",
    checkUpdates: "Check for updates",
    installUpdate: "Download and install",
    restart: "Restart now",
    updateIdle: "Updates are checked in the background after initialization.",
    updateDisabled: "Initialize the template and use a production build to enable updates.",
    updateCurrent: "You are up to date.",
    updateAvailable: "Version {version} is available.",
    updateChecking: "Checking for updates…",
    updateDownloading: "Downloading update…",
    updateReady: "Update installed. Restart to finish.",
    diagnostics: "Diagnostics log",
    clear: "Clear",
    waiting: "Waiting for application logs…",
    noTauri: "Run inside the Tauri desktop app to use IPC.",
  },
  zh: {
    appName: "Your App",
    home: "首页",
    settings: "设置",
    logs: "日志",
    templateReady: "桌面应用基础模板已就绪。",
    templateHint: "发布应用前，请先运行一次 template:init。",
    environment: "运行环境",
    environmentText: "Tauri 2 · React 19 · TypeScript",
    ipcTitle: "Rust IPC 示例",
    name: "名称",
    greet: "发送问候",
    greetingPlaceholder: "输入名称",
    language: "语言",
    autostart: "开机启动",
    autostartHint: "登录系统后在托盘中静默启动。",
    updates: "应用更新",
    checkUpdates: "检查更新",
    installUpdate: "下载并安装",
    restart: "立即重启",
    updateIdle: "初始化模板后，应用将在后台检查更新。",
    updateDisabled: "请先初始化模板，并使用生产构建以启用更新。",
    updateCurrent: "当前已是最新版本。",
    updateAvailable: "发现新版本 {version}。",
    updateChecking: "正在检查更新…",
    updateDownloading: "正在下载更新…",
    updateReady: "更新已安装，重启后生效。",
    diagnostics: "诊断日志",
    clear: "清空",
    waiting: "正在等待应用日志…",
    noTauri: "请在 Tauri 桌面应用中运行以使用 IPC。",
  },
} as const;

export type MessageKey = keyof (typeof messages)["en"];

export function translate(language: Language, key: MessageKey, values?: Record<string, string>) {
  let value: string = messages[language][key];
  for (const [name, replacement] of Object.entries(values ?? {})) {
    value = value.replace(`{${name}}`, replacement);
  }
  return value;
}
