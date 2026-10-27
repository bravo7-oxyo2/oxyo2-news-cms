import { config } from './config.js'

export class TelegramConfigurationError extends Error {}
export class TelegramDeliveryError extends Error {}
export class TelegramReportValidationError extends Error {}

const requiredHeadings = ['Context retrieval', 'Execution', 'Findings', 'Change and PR', 'Next action']
const reportHeader = /^ThePaperLeaf GSC Optimizer — \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\nOutcome: (?:SUCCESS|ADVISORY_ONLY|BLOCKED|FAILED)$/m
const sensitiveContent = /(?:authorization:\s*bearer|gsc_automation_export_token|telegram_bot_token|refresh[_ -]?token|client[_ -]?secret|\/Users\/|\/home\/ubuntu\/apps\/cms|Traceback \(most recent call last\)|\n\s*at\s+\S+\s*\()/i

export function validateGscTelegramReport(value: unknown) {
  if (typeof value !== 'string') throw new TelegramReportValidationError('Telegram report must be text.')
  const message = value.trim()
  if (!message || message.length > 4096) throw new TelegramReportValidationError('Telegram report must contain 1 to 4096 characters.')
  if (!reportHeader.test(message) || requiredHeadings.some(heading => !message.includes(`\n${heading}\n`))) {
    throw new TelegramReportValidationError('Telegram report does not match the required GSC optimizer format.')
  }
  if (sensitiveContent.test(message) || message.includes('\0')) throw new TelegramReportValidationError('Telegram report contains prohibited sensitive or diagnostic content.')
  return message
}

export async function sendTelegramReport(message: string) {
  const token = config.TELEGRAM_BOT_TOKEN
  const chatId = config.TELEGRAM_CHAT_ID
  if (!token || !chatId) throw new TelegramConfigurationError('Telegram reporting is not configured.')

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    })
    const body = await response.json().catch(() => null) as { ok?: boolean } | null
    if (!response.ok || body?.ok !== true) throw new TelegramDeliveryError('Telegram report delivery failed.')
  } catch (error) {
    if (error instanceof TelegramDeliveryError) throw error
    throw new TelegramDeliveryError('Telegram report delivery failed.')
  }
}
