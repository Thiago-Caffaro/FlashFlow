import 'server-only'
import { encryptSecret, decryptSecret } from './ai-crypto'
import { supabaseAdmin } from './supabase-admin'

export async function getSetting(key: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('encrypted_value, value_iv, value_auth_tag')
    .eq('key', key)
    .maybeSingle()
  if (error) {
    console.error(`[app-settings] Failed to read key="${key}":`, error.message)
    return null
  }
  if (!data) return null
  try {
    return decryptSecret(data.encrypted_value, data.value_iv, data.value_auth_tag)
  } catch (err) {
    console.error(`[SECURITY] Decryption failed for app_settings key="${key}":`, err instanceof Error ? err.message : err)
    return null
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  const encrypted = encryptSecret(value)
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({
      key,
      encrypted_value: encrypted.encrypted_key,
      value_iv: encrypted.iv,
      value_auth_tag: encrypted.auth_tag,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
  if (error) throw new Error(`Falha ao salvar configuração "${key}": ${error.message}`)
}

export async function deleteSetting(key: string): Promise<void> {
  await supabaseAdmin.from('app_settings').delete().eq('key', key)
}
