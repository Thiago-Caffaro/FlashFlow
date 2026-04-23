import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function getKey(): Buffer {
  const hex = process.env.AI_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) throw new Error('AI_ENCRYPTION_KEY must be a 32-byte hex string')
  return Buffer.from(hex, 'hex')
}

export function encrypt(plain: string): { encrypted_key: string; iv: string; auth_tag: string } {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return {
    encrypted_key: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    auth_tag: cipher.getAuthTag().toString('base64'),
  }
}

export function decrypt(encrypted_key: string, iv: string, auth_tag: string): string {
  const key = getKey()
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(auth_tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted_key, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
