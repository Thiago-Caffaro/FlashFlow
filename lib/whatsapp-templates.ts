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
  status_reason: string | null
  status_updated_at: string | null
  last_synced_at: string | null
}

const KNOWN_STATUSES: WhatsAppTemplateStatus[] = ['pending', 'approved', 'rejected', 'paused', 'disabled']

// A Meta usa "NONE" quando não há motivo (aprovação, por exemplo) — guarda
// null nesse caso para a UI não precisar conhecer esse valor mágico.
function normalizeReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed && trimmed.toUpperCase() !== 'NONE' ? trimmed : null
}

// Eventos do webhook message_template_status_update → status local. null =
// evento irrelevante para o envio (ex: aviso de qualidade), o status atual
// fica como está.
export function mapTemplateEventToStatus(event: string): WhatsAppTemplateStatus | null {
  switch (event.toUpperCase()) {
    case 'APPROVED':
    case 'REINSTATED':
      return 'approved'
    case 'REJECTED':
      return 'rejected'
    case 'PENDING':
    case 'IN_APPEAL':
      return 'pending'
    case 'PAUSED':
      return 'paused'
    case 'DISABLED':
    case 'DELETED':
      return 'disabled'
    default:
      return null
  }
}

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
    `/${credentials.waba_id}/message_templates?fields=id,name,language,category,status,rejected_reason,components&limit=250`,
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
      status_reason: normalizeReason(raw.rejected_reason),
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

export interface TemplateStatusUpdate {
  metaTemplateId: string
  event: string
  reason: string | null
}

// Aplica um evento message_template_status_update ao espelho local.
// 'unknown' = o template ainda não existe aqui (criado no Gerenciador do
// WhatsApp depois da última sincronização) — o chamador decide sincronizar.
export async function applyTemplateStatusUpdate(
  update: TemplateStatusUpdate
): Promise<'updated' | 'unknown' | 'ignored'> {
  const status = mapTemplateEventToStatus(update.event)
  if (!status) return 'ignored'

  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('whatsapp_message_templates')
    .update({
      status,
      status_reason: normalizeReason(update.reason),
      status_updated_at: now,
      updated_at: now,
    })
    .eq('meta_template_id', update.metaTemplateId)
    .select('id')
  if (error) throw new Error(`Falha ao atualizar status do template: ${error.message}`)
  return data && data.length > 0 ? 'updated' : 'unknown'
}

// O entry.id do webhook é o ID da WABA — mas a mesma conta pode aparecer
// sob dois IDs (o que gravamos na conta e o que a Meta manda), então se
// nenhuma conta bate com ele sincroniza todas as contas Cloud API (poucas,
// e cada sincronização é uma única chamada à Meta).
export async function syncTemplatesForWaba(wabaId: string): Promise<number> {
  const { data: matching } = await supabaseAdmin
    .from('whatsapp_cloud_credentials')
    .select('instance_name')
    .eq('waba_id', wabaId)
  let instances = (matching ?? []) as Array<{ instance_name: string }>
  if (instances.length === 0) {
    const { data: all } = await supabaseAdmin.from('whatsapp_cloud_credentials').select('instance_name')
    instances = (all ?? []) as Array<{ instance_name: string }>
  }

  let synced = 0
  for (const { instance_name } of instances) {
    try {
      synced += (await syncWhatsAppTemplates(instance_name)).synced
    } catch (error) {
      console.error(`[whatsapp-templates] sincronização de "${instance_name}" falhou:`, error instanceof Error ? error.message : error)
    }
  }
  return synced
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
