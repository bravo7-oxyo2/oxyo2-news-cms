import { request as httpsRequest } from 'node:https'
import { config } from './config.js'

export class TelegramConfigurationError extends Error {}
export class TelegramDeliveryError extends Error {}
export class TelegramReportValidationError extends Error {}

const requiredHeadings = ['Context retrieval', 'Execution', 'Findings', 'Change and PR', 'Next action']
const reportHeader = /^ThePaperLeaf GSC Optimizer — \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\nOutcome: (?:SUCCESS|ADVISORY_ONLY|BLOCKED|FAILED)$/m
const sensitiveContent = /(?:authorization:\s*bearer|gsc_automation_export_token|telegram_bot_token|refresh[_ -]?token|client[_ -]?secret|\/Users\/|\/home\/ubuntu\/apps\/cms|Traceback \(most recent call last\)|\n\s*at\s+\S+\s*\()/i
const telegramResponseLimit = 64 * 1024

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
    const payload = JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true })
    const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const request = httpsRequest({
        protocol: 'https:',
        hostname: 'api.telegram.org',
        port: 443,
        family: 4,
        method: 'POST',
        path: `/bot${token}/sendMessage`,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, providerResponse => {
        providerResponse.setEncoding('utf8')
        const chunks: string[] = []
        let receivedBytes = 0
        providerResponse.on('data', (chunk: string) => {
          receivedBytes += Buffer.byteLength(chunk)
          if (receivedBytes > telegramResponseLimit) {
            request.destroy(new TelegramDeliveryError('Telegram report delivery failed.'))
            return
          }
          chunks.push(chunk)
        })
        providerResponse.on('end', () => {
          clearTimeout(timeout)
          resolve({ statusCode: providerResponse.statusCode ?? 0, body: chunks.join('') })
        })
        providerResponse.on('error', error => {
          clearTimeout(timeout)
          reject(error)
        })
      })
      const timeout = setTimeout(() => request.destroy(new TelegramDeliveryError('Telegram report delivery failed.')), 15_000)
      request.on('error', error => {
        clearTimeout(timeout)
        reject(error)
      })
      request.end(payload)
    })
    const body = JSON.parse(response.body) as { ok?: boolean }
    if (response.statusCode !== 200 || body.ok !== true) throw new TelegramDeliveryError('Telegram report delivery failed.')
  } catch (error) {
    if (error instanceof TelegramDeliveryError) throw error
    throw new TelegramDeliveryError('Telegram report delivery failed.')
  }
}
