import type { Modulo, Usuario } from '../types';
import { temaAtual } from '../utils/theme';

/** O token da sessão acompanha toda requisição no header Authorization */
let tokenAtual: string | null = null;
let aoExpirar: ((msg: string) => void) | null = null;

export const setTokenSessao = (token: string | null) => {
  cacheListas = null; // outro usuário: outras preferências
  tokenAtual = token;
};

/** Chamado quando o servidor recusa o token (sessão expirada ou usuário removido) */
export const setAoExpirarSessao = (fn: ((msg: string) => void) | null) => {
  aoExpirar = fn;
};

async function chamar<T>(method: string, url: string, corpo?: unknown): Promise<T> {
  const h: Record<string, string> = {};
  if (tokenAtual) h.Authorization = `Bearer ${tokenAtual}`;
  if (corpo !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo), cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.erro || `Falha na requisição (HTTP ${res.status}).`;
    if (res.status === 401 && tokenAtual && aoExpirar) aoExpirar(msg);
    throw new Error(msg);
  }
  return data as T;
}

const get = <T>(url: string) => chamar<T>('GET', url);

// ---------- Sessão ----------
export const login = (login: string, senha: string) => chamar<{ token: string; usuario: Usuario }>('POST', '/api/login', { login, senha });
export const revalidarSessao = () => get<{ usuario: Usuario }>('/api/sessao');

// ---------- Painel ----------
export const indicadores = () => get<{ usuarios: number; empresas: number }>('/api/indicadores');

// ---------- Cadastros (tabelas sys_* do ERP) ----------
export type Cadastro = 'grupos' | 'empresas' | 'perfis' | 'usuarios';
export const listar = <T>(cadastro: Cadastro) => get<T[]>(`/api/${cadastro}`);
export const salvarCadastro = (cadastro: Cadastro, id: number | null, dados: object) =>
  // id 0 é válido (grupo e empresa de demonstração): só null é inclusão
  chamar<{ id: number }>(id !== null ? 'PUT' : 'POST', id !== null ? `/api/${cadastro}/${id}` : `/api/${cadastro}`, dados);
export const excluirCadastro = (cadastro: Cadastro, id: number) => chamar<void>('DELETE', `/api/${cadastro}/${id}`);

// ---------- Configurações dos módulos por grupo (sys_grupos.config) ----------
export const lerConfigGrupo = (grupoId: number) => get<Record<string, any>>(`/api/grupos/${grupoId}/config`);
export const salvarConfigGrupo = (grupoId: number, modulo: string, dados: object) => chamar<void>('PUT', `/api/grupos/${grupoId}/config/${modulo}`, dados);

// ---------- Certificado digital A1 da empresa (sys_empresas_certificados: o erp-nfe e o erp-nfs leem dali) ----------
/** Dados públicos do certificado (sem arquivo nem senha); datas "aaaa-mm-dd hh:mm:ss" */
export interface Certificado {
  nome_arquivo: string;
  cnpj: string | null;
  razao_social: string | null;
  numero_serie: string | null;
  emissor: string | null;
  valido_de: string;
  valido_ate: string;
  /** Dias para vencer (negativo = vencido) */
  dias: number;
  atualizado_em: string;
}
export const lerCertificado = (empresaId: number) => get<{ certificado: Certificado | null }>(`/api/empresas/${empresaId}/certificado`);
/** arquivo: .pfx em base64 */
export const gravarCertificado = (empresaId: number, dados: { arquivo: string; nome: string; senha: string }) =>
  chamar<void>('PUT', `/api/empresas/${empresaId}/certificado`, dados);
export const removerCertificado = (empresaId: number) => chamar<void>('DELETE', `/api/empresas/${empresaId}/certificado`);

// ---------- Caixas do PDV da empresa (pdv_caixas: o erp-pdv confere o token no login) ----------
/** Datas "aaaa-mm-dd hh:mm" */
export interface CaixaPdv {
  id: number;
  numero: number;
  descricao: string;
  usuario_id: number | null;
  login: string | null;
  /** NNNN-NNNN, digitado no computador do caixa */
  token: string;
  ativo: number;
  registrado_em: string | null;
  ultimo_acesso: string | null;
  ultimo_login: string | null;
  ultimo_ip: string;
  /** TEF SiTEF (Agente CliSiTef no computador do caixa): os três ou nenhum */
  sitef_ip: string | null;
  sitef_loja: string | null;
  sitef_terminal: string | null;
  /** Tela touch: o erp-pdv deste computador mostra o teclado virtual */
  teclado_virtual: number;
  /** Balança de checkout na porta serial do computador do caixa */
  balanca: number;
  balanca_velocidade: number;
  balanca_formato: string;
}
export const listarCaixas = (empresaId: number) => get<CaixaPdv[]>(`/api/empresas/${empresaId}/caixas`);
export const usuariosDosCaixas = (empresaId: number) => get<{ id: number; login: string }[]>(`/api/empresas/${empresaId}/caixas/usuarios`);
/** novo_token: troca o token (desliga o computador registrado com o anterior) */
export const salvarCaixa = (empresaId: number, caixaId: number | null, dados: { descricao: string; usuario_id: number | null; ativo?: boolean; novo_token?: boolean; sitef_ip: string; sitef_loja: string; sitef_terminal: string; teclado_virtual: boolean; balanca: boolean; balanca_velocidade: number; balanca_formato: string }) =>
  chamar<{ id: number }>(caixaId !== null ? 'PUT' : 'POST', caixaId !== null ? `/api/empresas/${empresaId}/caixas/${caixaId}` : `/api/empresas/${empresaId}/caixas`, dados);
/** Exclusão lógica: o computador do caixa deixa de entrar no PDV */
export const inativarCaixa = (empresaId: number, caixaId: number) => chamar<void>('DELETE', `/api/empresas/${empresaId}/caixas/${caixaId}`);

// ---------- Imagens do PDV da empresa (pdv_imagens: vitrine da tela de venda do erp-pdv) ----------
/** Datas "aaaa-mm-dd"; a imagem só vem por lerImagemPdv */
export interface ImagemPdv {
  id: number;
  titulo: string | null;
  tipo: string;
  /** Bytes da imagem gravada */
  tamanho: number;
  data_inicio: string | null;
  data_fim: string | null;
  ordem: number;
  ativo: number;
}
/** tela: caixa = vitrine da tela de venda (3:2); cliente = coluna da tela do cliente (vertical 2:3) */
export type TelaImagem = 'caixa' | 'cliente';
export const listarImagensPdv = (empresaId: number, tela: TelaImagem) => get<ImagemPdv[]>(`/api/empresas/${empresaId}/imagens?tela=${tela}`);
export const lerImagemPdv = (empresaId: number, imagemId: number) => get<{ imagem: string; tipo: string }>(`/api/empresas/${empresaId}/imagens/${imagemId}`);
/** imagem em base64 (sem o "data:"); na edição, sem imagem mantém a gravada */
export const salvarImagemPdv = (
  empresaId: number,
  imagemId: number | null,
  dados: { tela: TelaImagem; titulo: string; data_inicio: string; data_fim: string; ordem: number; ativo: boolean; imagem?: string; tipo?: string },
) => chamar<{ id: number }>(imagemId !== null ? 'PUT' : 'POST', imagemId !== null ? `/api/empresas/${empresaId}/imagens/${imagemId}` : `/api/empresas/${empresaId}/imagens`, dados);
export const excluirImagemPdv = (empresaId: number, imagemId: number) => chamar<void>('DELETE', `/api/empresas/${empresaId}/imagens/${imagemId}`);

// ---------- Desenvolvedor do PAF-NFC-e (sys_paf, uma linha para todo o ERP; só o super) ----------
export interface Desenvolvedor {
  desenvolvedor_razao: string;
  desenvolvedor_cnpj: string;
  desenvolvedor_ie: string;
  desenvolvedor_im: string;
  desenvolvedor_endereco: string;
  desenvolvedor_telefone: string;
  desenvolvedor_responsavel: string;
  arq_bd: string;
  arq_sist: string;
  /** Versão do PAF-NFC-e: uma só para o erp-pdv e o erp-vendas (verProc e registro 3 do Menu Fiscal) */
  versao: string;
  atualizado_em?: string | null;
}
export const lerDesenvolvedor = () => get<{ desenvolvedor: Desenvolvedor | null }>('/api/desenvolvedor');
export const gravarDesenvolvedor = (d: Desenvolvedor) => chamar<void>('PUT', '/api/desenvolvedor', d);

// ---------- Campos das pesquisas do erp-vendas por grupo (ven_pesquisa_campos; só o super) ----------
export interface CampoPesquisa {
  id: number;
  pesquisa: string;
  chave: string;
  /** null = campo do sistema (chave do catálogo do erp-vendas) */
  tabela: string | null;
  coluna: string | null;
  label: string;
  formato: string | null;
  busca: string | null;
  visivel: number;
  ativo: number;
  buscavel: boolean;
}
export const tabelasPesquisa = () => get<Record<string, { tabela: string; rotulo: string }[]>>('/api/pesquisa-campos/tabelas');
/** sistema = nome do campo do sistema que mostra a coluna (gravá-la grava esse campo) */
export interface ColunaPesquisa {
  coluna: string;
  tipo: string;
  sistema?: string;
  formato?: string;
  busca?: string;
}
export const colunasPesquisa = (grupoId: number, pesquisa: string, tabela: string) =>
  get<ColunaPesquisa[]>(`/api/pesquisa-campos/colunas?grupo=${grupoId}&pesquisa=${encodeURIComponent(pesquisa)}&tabela=${encodeURIComponent(tabela)}`);
export const listarCamposPesquisa = (grupoId: number, pesquisa: string) => get<CampoPesquisa[]>(`/api/grupos/${grupoId}/pesquisa-campos?pesquisa=${encodeURIComponent(pesquisa)}`);
export const salvarCampoPesquisa = (grupoId: number, id: number | null, dados: object) =>
  chamar<{ id: number }>(id !== null ? 'PUT' : 'POST', `/api/grupos/${grupoId}/pesquisa-campos${id !== null ? `/${id}` : ''}`, dados);
export const excluirCampoPesquisa = (grupoId: number, id: number) => chamar<void>('DELETE', `/api/grupos/${grupoId}/pesquisa-campos/${id}`);
// SQL da pesquisa: padrão (gerado) e próprio do grupo (sys_grupos.config → pesquisas_sql)
export const lerSqlPesquisa = (grupoId: number, pesquisa: string) =>
  get<{ padrao: string; proprio: string | null }>(`/api/grupos/${grupoId}/pesquisa-sql?pesquisa=${encodeURIComponent(pesquisa)}`);
/** Roda o SQL só leitura: linhas e colunas do grid que faltam */
export const testarSqlPesquisa = (grupoId: number, pesquisa: string, sql: string, busca: string) =>
  chamar<{ linhas: number; faltam: string[] }>('POST', `/api/grupos/${grupoId}/pesquisa-sql/testar`, { pesquisa, sql, busca });
/** Raw: o SQL final, com os marcadores trocados pelos valores (filial do grupo e busca de exemplo) */
export const rawSqlPesquisa = (grupoId: number, pesquisa: string, sql: string, busca: string) =>
  chamar<{ sql: string; empresa: number }>('POST', `/api/grupos/${grupoId}/pesquisa-sql/raw`, { pesquisa, sql, busca });
/** Testa e grava o SQL próprio do grupo */
export const salvarSqlPesquisa = (grupoId: number, pesquisa: string, sql: string) =>
  chamar<{ linhas: number; faltam: string[] }>('PUT', `/api/grupos/${grupoId}/pesquisa-sql`, { pesquisa, sql });
/** Voltar Padrão: apaga o SQL próprio */
export const padraoSqlPesquisa = (grupoId: number, pesquisa: string) => chamar<void>('DELETE', `/api/grupos/${grupoId}/pesquisa-sql?pesquisa=${encodeURIComponent(pesquisa)}`);
/** Criar Pesquisa: grava os campos do sistema que faltam no grupo */
export const criarPadraoPesquisa = (grupoId: number, pesquisa: string) =>
  chamar<{ criados: number }>('POST', `/api/grupos/${grupoId}/pesquisa-campos/padrao?pesquisa=${encodeURIComponent(pesquisa)}`);
/** Voltar ao padrão: apaga todos os campos do grupo nessa pesquisa */
export const padraoCamposPesquisa = (grupoId: number, pesquisa: string) =>
  chamar<{ excluidos: number }>('DELETE', `/api/grupos/${grupoId}/pesquisa-campos?pesquisa=${encodeURIComponent(pesquisa)}`);

// ---------- Preferências das listas e formulários (sys_usuarios.config_listas) ----------
// Lidas uma vez por sessão e gravadas por chave. Se a leitura falhar, nada é gravado: um PUT só com uma chave
// apagaria as demais.
let cacheListas: Promise<Record<string, any>> | null = null;

export function lerConfigListas(): Promise<Record<string, any>> {
  if (!cacheListas) {
    cacheListas = get<Record<string, any>>('/api/config-listas').catch((e) => {
      cacheListas = null;
      throw e;
    });
  }
  return cacheListas;
}

export async function gravarConfigLista(chave: string, valor: unknown) {
  const novo = { ...(await lerConfigListas()), [chave]: valor };
  await chamar<void>('PUT', '/api/config-listas', novo);
  cacheListas = Promise.resolve(novo);
}

// ---------- Módulos ----------
/** Árvore de módulos que o usuário acessa (pai_id 0 = raiz) */
export const meusModulos = () => get<Modulo[]>('/api/modulos');
/** Endereço de acesso a um módulo, montado no servidor. volta:o módulo volta para este endereço do Master (com ?erro=) se não conseguir entrar; tema: o modo do Master */
export const linkModulo = (id: number) =>
  get<{ url: string }>(`/api/modulos/${id}/link?volta=${encodeURIComponent(window.location.origin + '/')}&tema=${temaAtual()}`);
