export const metadata = {
  title: 'Política de Privacidade — FlashFlow',
}

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen overflow-y-auto bg-[#111b21] text-gray-200 px-6 py-12">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-semibold text-white">Política de Privacidade</h1>
        <p className="text-sm text-gray-400">Última atualização: setembro de 2026</p>

        <p>
          Esta política descreve como o <strong>FlashFlow</strong>, plataforma de atendimento e
          automação via WhatsApp operada por <strong>Maranata Promoção e Divulgação Digital</strong>,
          coleta, usa e protege dados no contexto do atendimento a clientes via WhatsApp.
        </p>

        <section className="space-y-2">
          <h2 className="text-lg font-medium text-white">Dados que coletamos</h2>
          <p>
            Número de telefone, nome de contato e o conteúdo das mensagens trocadas com o
            número de WhatsApp da empresa, além de dados de pedidos (quando aplicável) usados
            para confirmação e acompanhamento de entrega.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium text-white">Como usamos esses dados</h2>
          <p>
            Os dados são usados exclusivamente para prestar atendimento ao cliente, confirmar
            pedidos, enviar atualizações de status e automatizar respostas via fluxos de
            conversa configurados pela empresa. Não vendemos nem compartilhamos esses dados
            com terceiros para fins de marketing.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium text-white">Serviços de terceiros</h2>
          <p>
            Utilizamos a WhatsApp Business Platform (Meta) para envio e recebimento de
            mensagens, e podemos integrar com plataformas de e-commerce (como Shopify) e
            serviços de fulfillment para processar pedidos. Cada um desses serviços possui
            sua própria política de privacidade.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium text-white">Retenção e segurança</h2>
          <p>
            Os dados são armazenados de forma segura e mantidos apenas pelo tempo necessário
            para a prestação do atendimento e cumprimento de obrigações legais.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium text-white">Seus direitos</h2>
          <p>
            Você pode solicitar a exclusão dos seus dados ou esclarecer dúvidas sobre esta
            política entrando em contato pelo próprio WhatsApp da empresa.
          </p>
        </section>
      </div>
    </main>
  )
}
