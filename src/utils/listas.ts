/** Valores aceitos pelo ERP (usados na tela e validados no servidor) */

export const TIPOS_ATUACAO = ['CONSTRUTORA', 'INCORPORADORA', 'IMOBILIARIA', 'HOLDING', 'SERVICOS', 'COMERCIO', 'INDUSTRIA'];

export const NOME_ATUACAO: Record<string, string> = {
  CONSTRUTORA: 'Construtora',
  INCORPORADORA: 'Incorporadora',
  IMOBILIARIA: 'Imobiliária',
  HOLDING: 'Holding',
  SERVICOS: 'Serviços',
  COMERCIO: 'Comércio',
  INDUSTRIA: 'Indústria',
};

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

/** Finalidades das contas de e-mail da empresa (sys_empresas_smtp.finalidade): o módulo sem conta própria usa a padrão */
export const FINALIDADES_SMTP: Record<string, string> = {
  padrao: 'Padrão (todos os módulos)',
  nfe: 'NF-e / NFC-e',
  compras: 'Compras (cotações)',
  crm_comercial: 'CRM comercial (propostas, pedidos, campanhas)',
  crm_suporte: 'CRM suporte (chamados)',
};
