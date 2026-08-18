import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { fetchCloudApi } from './whatsapp-cloud-client'
import { decodeCloudAccessToken, loadCloudCredentials } from './whatsapp-cloud-credentials'

export type WhatsAppTemplateStatus = 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled'

export interface WhatsAppMessageTemplateRow {
  id: string
  instance_name: string
  meta_template_id: string | null
  meta_template_name: string
  language: string
  category: string | null
  status: WhatsAppTemplateStatus
  body_text: string
  variable_count: number
  header_type: string | null
  footer_text: string | null
  buttons: unknown
  last_synced_at: string | null
}

const KNOWN_STATUSES: WhatsAppTemplateStatus[] = ['pending', 'approved', 'rejected', 'paused', 'disabled']

function asComponentList(components: unknown): Array<Record<string, unknown>> {
  return Array.isArray(components) ? components as Array<Record<string, unknown>> : []
}

// A Meta devolve {{1}}, {{2}}... posicionais no corpo do template (diferente
// de {{contato.nome}} nomeado que o FlashFlow usa em mensagens livres) —
// conta as ocorrências para saber quantos parâmetros o envio precisa.
function extractBodyComponent(components: unknown): { text: string; variableCount: number } {
  const body = asComponentList(components).find((c) => c.type === 'BODY')
  const text = typeof body?.text === 'string' ? body.text : ''
  const variableCount = new Set(text.match(/\{\{\d+\}\}/g) ?? []).size
  return { text, variableCount }
}

function extractHeaderType(components: unknown): string | null {
  const header = asComponentList(components).find((c) => c.type === 'HEADER')
  return typeof header?.format === 'string' ? header.format : null
}

function extractFooterText(components: unknown): string | null {
  const footer = asComponentList(components).find((c) => c.type === 'FOOTER')
  return typeof footer?.text === 'string' ? footer.text : null
}

function extractButtons(components: unknown): unknown[] {
  const buttonsComponent = asComponentList(components).find((c) => c.type === 'BUTTONS')
  return Array.isArray(buttonsComponent?.buttons) ? buttonsComponent.buttons as unknown[] : []
}

function normalizeStatus(raw: unknown): WhatsAppTemplateStatus {
  const status = typeof raw === 'string' ? raw.toLowerCase() : ''
  return (KNOWN_STATUSES as string[]).includes(status) ? status as WhatsAppTemplateStatus : 'pending'
}

// Sincronização sob demanda (não em tempo real via webhook nesta fase) —
// busca todos os templates do WABA e faz upsert local. Templates removidos
// no lado da Meta não são apagados daqui automaticamente; a próxima
// sincronização apenas atualiza os que ainda existem.
export async function syncWhatsAppTemplates(instanceName: string): Promise<{ synced: number; total: number }> {
  const credentials = await loadCloudCredentials(instanceName)
  if (!credentials) throw new Error(`Conta "${instanceName}" não tem credenciais da WhatsApp Cloud API configuradas`)

  const accessToken = decodeCloudAccessToken(credentials)
  const response = await fetchCloudApi(
    `/${credentials.waba_id}/message_templates?fields=id,name,language,category,status,components&limit=250`,
    accessToken,
    { method: 'GET' },
    15_000
  )
  if (!response.ok) {
    throw new Error(`Falha ao sincronizar templates (${response.status}): ${response.text.slice(0, 300)}`)
  }

  const body = response.body && typeof response.body === 'object' ? response.body as Record<string, unknown> : {}
  const data = Array.isArray(body.data) ? body.data as Array<Record<string, unknown>> : []

  let synced = 0
  for (const raw of data) {
    const name = typeof raw.name === 'string' ? raw.name : ''
    const language = typeof raw.language === 'string' ? raw.language : ''
    if (!name || !language) continue
    const { text: bodyText, variableCount } = extractBodyComponent(raw.components)

    const { error } = await supabaseAdmin.from('whatsapp_message_templates').upsert({
      instance_name: instanceName,
      meta_template_id: typeof raw.id === 'string' ? raw.id : null,
      meta_template_name: name,
      language,
      category: typeof raw.category === 'string' ? raw.category : null,
      status: normalizeStatus(raw.status),
      body_text: bodyText,
      variable_count: variableCount,
      header_type: extractHeaderType(raw.components),
      footer_text: extractFooterText(raw.components),
      buttons: extractButtons(raw.components),
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'instance_name,meta_template_name,language' })
    if (!error) synced++
  }

  return { synced, total: data.length }
}

export async function loadWhatsAppTemplates(instanceName: string): Promise<WhatsAppMessageTemplateRow[]> {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_message_templates')
    .select('*')
    .eq('instance_name', instanceName)
    .order('meta_template_name', { ascending: true })
  if (error) throw new Error(`Falha ao carregar templates: ${error.message}`)
  return (data ?? []) as WhatsAppMessageTemplateRow[]
}

export async function loadWhatsAppTemplateById(templateId: string): Promise<WhatsAppMessageTemplateRow | null> {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_message_templates')
    .select('*')
    .eq('id', templateId)
    .maybeSingle()
  if (error) throw new Error(`Falha ao carregar template: ${error.message}`)
  return data as WhatsAppMessageTemplateRow | null
}
