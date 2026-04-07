# Descrição do Projeto - FlashFlow

## Introdução

FlashFlow é uma plataforma SaaS desenvolvida para permitir a criação e gerenciamento de fluxos de conversa automatizados no WhatsApp, com forte integração de Inteligência Artificial (Gemini).

O sistema foi projetado para substituir ferramentas terceiras como o BotConversa, oferecendo maior controle, redução de custos e alta customização conforme as necessidades específicas do negócio.

## Problema que Resolve

- Alto custo das plataformas existentes
- Pouca flexibilidade para criar fluxos complexos por produto
- Dificuldade de integração com múltiplos números e países
- Dependência total da ferramenta externa

## Solução Proposta

Uma plataforma própria com as seguintes capacidades:

- **Construtor Visual de Fluxos**: Interface drag-and-drop intuitiva para criar fluxos personalizados sem necessidade de programação.
- **Gatilho por Mensagem Inicial**: Links externos disparam automaticamente o fluxo correto de acordo com o produto desejado (atualmente 4 produtos).
- **Inteligência Artificial Integrada**: Blocos que utilizam Gemini 2.5 Flash para respostas dinâmicas, persuasivas e humanizadas, sempre respeitando o escopo definido.
- **Interface de Atendimento**: Replica fiel da experiência do WhatsApp Web para que os atendentes humanos se sintam confortáveis.
- **Analytics Avançado**: Dashboard completo com métricas de conversão, taxa de resposta, custo de IA e desempenho por país.
- **Suporte Multi-País**: Adaptação automática de idioma, moeda e abordagem comercial para os 4 países atendidos.

## Tecnologias Principais

- Frontend: Next.js 15 + React 19 + xyflow
- Backend: Node.js (NestJS) ou Python
- Banco: PostgreSQL com JSONB
- IA: Google Gemini 2.5 Flash / Flash-Lite
- WhatsApp: Evolution API (QR Code) → futura migração para Cloud API

## Benefícios Esperados

- Redução significativa nos custos mensais
- Total controle sobre os fluxos e dados
- Possibilidade de evolução rápida conforme o negócio cresce
- Experiência unificada entre automação e atendimento humano
- Dashboard claro para tomada de decisão baseada em dados reais de vendas

## Próximos Passos

1. Configuração completa do projeto no Claude Projects
2. Desenvolvimento do MVP (4-6 semanas)
3. Testes com 1 número WhatsApp e os 4 produtos
4. Expansão para multi-número e multi-país

**Data:** Abril 2026  
**Responsável:** Thiago