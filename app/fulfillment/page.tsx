'use client'

import { AuthProvider } from '@/contexts/auth-context'
import { ThemeProvider } from '@/contexts/theme-context'
import FulfillmentPage from '@/components/fulfillment/fulfillment-page'

export default function FulfillmentRoute() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <FulfillmentPage />
      </AuthProvider>
    </ThemeProvider>
  )
}
