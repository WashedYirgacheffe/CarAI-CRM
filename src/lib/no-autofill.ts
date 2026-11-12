/**
 * 搜索框、AI 对话框、快速添加这类「不是填表」的输入框：
 * 关掉浏览器的自动填充 / 历史联想（Chrome 弹出邮箱、地址那种），以及常见密码管理器的图标。
 * 真正的表单字段（登录邮箱、密码）显式写了 autoComplete，不受影响。
 */
export const noAutofill = {
  autoComplete: "off",
  autoCorrect: "off",
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;
