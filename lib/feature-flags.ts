// Flags temporárias de lançamento. `false` = feature escondida do público
// (link some do Header, rota redireciona pra "/"), sem apagar nenhum
// código. Pra religar mais tarde: troque o valor aqui, nada mais precisa
// mudar — Header.tsx e middleware.ts já leem daqui.

// Redação com correção por IA — escondida até decidirmos ativar
// ANTHROPIC_API_KEY em produção e cuidar da cota de correções.
export const REDACAO_ENABLED = false;

// Página de planos / assinatura Premium — escondida até configurar as
// chaves reais da Stripe em produção (ver README, seção "Monetização").
export const PLANOS_ENABLED = false;
