import 'server-only'
import { decryptSecret, encryptSecret } from './ai-crypto'
import { supabaseAdmin } from './supabase-admin'

export type WhatsAppCloudCredentialsRow = {
  instance_name: string
  waba_id: string
  phone_number_id: string
  business_id: string | null
  display_phone_number: string | null
  verified_name: string | null
  encrypted_access_token: string
  access_token_iv: string
  access_token_auth_tag: string
  token_expires_at: string | null
  last_verified_at: string | null
  last_error: string | null
}

export function decodeCloudAccessToken(row: WhatsAppCloudCredentialsRow): string {
  return decryptSecret(row.encrypted_access_token, row.access_token_iv, row.access_token_auth_tag)
}

export async function loadCloudCredentials(instanceName: string): Promise<WhatsAppCloudCredentialsRow | null> {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_cloud_credentials')
    .select('*')
    .eq('instance_name', instanceName)
    .maybeSingle()
  if (error) throw new Error(`Falha ao carregar credenciais da WhatsApp Cloud API: ${error.message}`)
  return data as WhatsAppCloudCredentialsRow | null
}

// Ponto de resolução usado pelo webhook: a Meta identifica a conta pelo
// phone_number_id no payload, não por um "instance name" próprio como a
// Evolution — por isso essa é a rota de leitura mais quente desta tabela.
export async function loadCloudCredentialsByPhoneNumberId(
  phoneNumberId: string
): Promise<WhatsAppCloudCredentialsRow | null> {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_cloud_credentials')
    .select('*')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle()
  if (error) throw new Error(`Falha ao carregar credenciais da WhatsApp Cloud API: ${error.message}`)
  return data as WhatsAppCloudCredentialsRow | null
}

export async function storeCloudCredentials(input: {
  instanceName: string
  wabaId: string
  phoneNumberId: string
  businessId?: string | null
  displayPhoneNumber?: string | null
  verifiedName?: string | null
  accessToken: string
}): Promise<void> {
  const encrypted = encryptSecret(input.accessToken)
  const { error } = await supabaseAdmin.from('whatsapp_cloud_credentials').insert({
    instance_name: input.instanceName,
    waba_id: input.wabaId,
    phone_number_id: input.phoneNumberId,
    business_id: input.businessId ?? null,
    display_phone_number: input.displayPhoneNumber ?? null,
    verified_name: input.verifiedName ?? null,
    encrypted_access_token: encrypted.encrypted_key,
    access_token_iv: encrypted.iv,
    access_token_auth_tag: encrypted.auth_tag,
    last_verified_at: new Date().toISOString(),
  })
  if (error) throw new Error(`Falha ao salvar credenciais da WhatsApp Cloud API: ${error.message}`)
}

// Best-effort — chamado a cada falha de envio para que o erro fique visível
// na UI da conta (informações da conta), não só em log de servidor. Nunca
// deve derrubar o fluxo de envio se a própria escrita falhar.
export async function recordCloudSendError(instanceName: string, message: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('whatsapp_cloud_credentials')
      .update({ last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('instance_name', instanceName)
    if (error) console.error('[whatsapp-cloud-credentials] falha ao registrar last_error:', error.message)
  } catch (err) {
    console.error('[whatsapp-cloud-credentials] falha ao registrar last_error:', err)
  }
}
