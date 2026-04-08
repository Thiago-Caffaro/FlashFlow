import { NextResponse } from 'next/server'

const EVOLUTION_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY
const INSTANCE = 'flashflow-main'

export async function GET() {
  const [chatsRes, contactsRes] = await Promise.all([
    fetch(`${EVOLUTION_URL}/chat/findChats/${INSTANCE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY! },
      body: JSON.stringify({}),
    }),
    fetch(`${EVOLUTION_URL}/contact/fetchContacts/${INSTANCE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY! },
      body: JSON.stringify({}),
    }),
  ])

  const chats = await chatsRes.json()
  const contacts = await contactsRes.json()

  // Mostra apenas os 3 primeiros de cada para não explodir o response
  return NextResponse.json({
    chats_sample: Array.isArray(chats) ? chats.slice(0, 3) : chats,
    contacts_sample: Array.isArray(contacts) ? contacts.slice(0, 3) : contacts,
  })
}
