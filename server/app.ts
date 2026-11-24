import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from './db.js';
import { emitirToken, lerToken } from './sessao.js';
import { carregarPfx } from './certificado.js';
import { CATALOGOS, COLUNAS_BLOQUEADAS, FORMATOS, MODOS, aplicarModelo, catalogoDoGrupo, executarLeitura, modeloSql, validarSqlProprio } from './pesquisaCatalogo.js';
import { cnpjValido, limparCnpj } from '../src/utils/cnpj.js';
import { FINALIDADES_SMTP, TIPOS_ATUACAO, UFS } from '../src/utils/listas.js';

type Linha = RowDataPacket & Record<string, unknown>;

type Nivel = 'super' | 'admin' | 'user';
const NIVEIS: Nivel[] = ['super', 'admin', 'user'];

interface UsuarioSessao {
  id: number;
  nome: string;
  email: string;
  /** sys_usuarios.nivel */
  role: Nivel;
  perfil_id: number;
  grupo_id: number;
}

/** Erro com status HTTP: a mensagem vai para o usuário como { erro } */
class ErroApi extends Error {
  constructor(public status: number, mensagem: string) {
    super(mensagem);
  }
}

/** Envolve a rota: erro vira { erro } com o status certo (500 sem detalhe de banco para o usuário) */
const rota = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json(r ?? { ok: true });
  } catch (err) {
    if (err instanceof ErroApi) return res.status(err.status).json({ erro: err.message });
    const codigo = (err as { code?: string }).code;
    if (codigo === 'ER_DUP_ENTRY') return res.status(400).json({ erro: 'Já existe um registro com esse valor.' });
    if (codigo === 'ER_ROW_IS_REFERENCED_2') return res.status(400).json({ erro: 'O registro está em uso e não pode ser excluído.' });
    console.error(`${req.method} ${req.path}:`, err);
    res.status(500).json({ erro: 'Erro interno do servidor. Tente novamente.' });
  }
};

const texto = (v: unknown, rotulo: string, max: number, obrigatorio = false): string => {
  const t = String(v ?? '').trim();
  if (obrigatorio && !t) throw new ErroApi(400, `${rotulo} é obrigatório.`);
  if (t.length > max) throw new ErroApi(400, `${rotulo}: no máximo ${max} caracteres.`);
  return t;
};
/** Código de registro: aceita 0 (no ERP, a empresa 0 é a de demonstração) */
const id = (v: unknown, rotulo = 'Código'): number => {
  const n = Number(v);
  if (v === '' || v == null || !Number.isInteger(n) || n < 0) throw new ErroApi(400, `${rotulo} inválido.`);
  return n;
};
const flag = (v: unknown) => (v === true || v === 1 || v === '1' ? 1 : 0);
const opcional = (v: unknown, rotulo: string, max: number) => texto(v, rotulo, max) || null;
const digitos = (v: unknown, max: number) => String(v ?? '').replace(/\D/g, '').slice(0, max);

/**
 * sys_usuarios.nivel: super = todos os grupos e empresas; admin = os cadastros, só do próprio grupo;
 * user = só os módulos. Valor desconhecido vale como user.
 */
const usuarioErp = (u: Linha): UsuarioSessao => ({
  id: Number(u.id),
  nome: String(u.nome || u.login),
  email: String(u.login),
  role: NIVEIS.includes(u.nivel as Nivel) ? (u.nivel as Nivel) : 'user',
  perfil_id: 0,
  grupo_id: Number(u.grupo_id),
});
const COLUNAS_SESSAO = 'id, login, nome, nivel, grupo_id';

const ehBcrypt = (hash: string) => /^\$2[aby]\$/.test(hash);

/** Senha do ERP: bcrypt, ou legado em texto puro, md5, sha256 ou sha1 (hex) */
async function senhaConfere(digitada: string, gravada: string): Promise<boolean> {
  if (ehBcrypt(gravada)) return bcrypt.compare(digitada, gravada).catch(() => false);
  if (digitada === gravada) return true;
  return ['md5', 'sha256', 'sha1'].some((alg) => crypto.createHash(alg).update(digitada).digest('hex') === gravada.toLowerCase());
}

const usuarioAtual = (res: Response) => res.locals.usuario as UsuarioSessao;

/** Cadastros: só admin/super. O user só usa os módulos */
function exigirAdmin(res: Response) {
  const { role } = usuarioAtual(res);
  if (role !== 'admin' && role !== 'super') throw new ErroApi(403, 'Acesso restrito a administradores.');
}
function exigirSuper(res: Response) {
  if (usuarioAtual(res).role !== 'super') throw new ErroApi(403, 'Só o usuário super pode fazer isso.');
}

/** Filtro do grupo: o super vê tudo ('1=1'); o admin só o próprio grupo (coluna = grupo dele) */
function doGrupo(res: Response, coluna: string): { sql: string; params: number[] } {
  const eu = usuarioAtual(res);
  return eu.role === 'super' ? { sql: '1=1', params: [] } : { sql: `${coluna} = ?`, params: [eu.grupo_id] };
}

/** Grupo de um registro gravado pelo admin: só o dele */
function grupoPermitido(res: Response, grupoId: number) {
  const eu = usuarioAtual(res);
  if (eu.role !== 'super' && grupoId !== eu.grupo_id) throw new ErroApi(403, 'Você só pode cadastrar no seu grupo.');
  return grupoId;
}

/** Módulos do lançador: todos, para admin e operador (a diferença é que o operador só tem esta tela) */
// ponytail: sem filtro por usuário; filtrar pelo sys_usuarios.config quando o formato das permissões estiver definido
async function modulosDoUsuario(): Promise<Linha[]> {
  return (await pool.query<Linha[]>('SELECT id, empresa_id, pai_id, sigla, descricao, descricao_detalhada, url, obs FROM sys_modulos ORDER BY pai_id, id'))[0];
}

/** App Express com todas as rotas /api. Local: server.ts adiciona o Vite e o listen; Vercel: api/index.ts */
export function createApp() {
  const app = express();
  // Imagens do PDV vêm em base64 (o Master já reduz; a folga é para PNG grande)
  app.use('/api/empresas/:id/imagens', express.json({ limit: '4mb' }));
  app.use(express.json({ limit: '1mb' }));

  // ==========================================================
  // Login igual ao do bm-estoque: usuário do ERP (sys_usuarios.login + senha_hash). Senha em branco no banco =
  // primeiro acesso; senhas legadas (texto, md5, sha) passam para bcrypt.
  // ==========================================================
  app.post(
    '/api/login',
    rota(async (req) => {
      const login = texto(req.body?.login, 'Usuário', 100, true);
      const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';

      const [rows] = await pool.query<Linha[]>(`SELECT ${COLUNAS_SESSAO}, senha_hash FROM sys_usuarios WHERE ativo = 1 AND LOWER(TRIM(login)) = ? LIMIT 1`, [login.toLowerCase()]);
      const u = rows[0];
      if (!u) throw new ErroApi(401, `O usuário "${login}" não foi localizado ou está inativo.`);

      const gravada = String(u.senha_hash ?? '');
      if (!gravada.trim() || gravada.toUpperCase() === 'NULL') {
        if (senha.trim().length < 4) throw new ErroApi(401, 'Primeiro acesso: defina uma senha com pelo menos 4 caracteres.');
        await pool.query('UPDATE sys_usuarios SET senha_hash = ? WHERE id = ?', [await bcrypt.hash(senha, 10), u.id]);
      } else {
        if (!(await senhaConfere(senha, gravada))) throw new ErroApi(401, 'Usuário/senha inválido(s).');
        if (!ehBcrypt(gravada)) await pool.query('UPDATE sys_usuarios SET senha_hash = ? WHERE id = ?', [await bcrypt.hash(senha, 10), u.id]);
      }
      await pool.query('UPDATE sys_usuarios SET ultimo_acesso = NOW() WHERE id = ?', [u.id]).catch(() => undefined);

      return { token: emitirToken(Number(u.id), String(u.login), senha), usuario: usuarioErp(u) };
    }),
  );

  // ==========================================================
  // Daqui para baixo, toda rota /api exige um token válido. O usuário é relido a cada
  // requisição: desativado no ERP ou com o nível/grupo trocado, vale na hora.
  // ==========================================================
  app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
    const sessao = lerToken(String(req.header('authorization') || '').replace(/^Bearer\s+/i, ''));
    if (!sessao) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
    try {
      const [rows] = await pool.query<Linha[]>(`SELECT ${COLUNAS_SESSAO} FROM sys_usuarios WHERE id = ? AND ativo = 1 LIMIT 1`, [sessao.usuarioId]);
      if (!rows.length) return res.status(401).json({ erro: 'Seu usuário foi desativado. Fale com o administrador.' });
      res.locals.usuario = usuarioErp(rows[0]);
      res.locals.credencial = sessao.credencial;
      next();
    } catch (err) {
      console.error('Sessão:', err);
      res.status(503).json({ erro: 'Banco de dados indisponível. Tente novamente.' });
    }
  });

  app.get('/api/sessao', rota(async (_req, res) => ({ usuario: usuarioAtual(res) })));

  // ==========================================================
  // Módulos (todos os papéis)
  // ==========================================================
  app.get('/api/modulos', rota(modulosDoUsuario));

  /** Endereço do módulo com o acesso do usuário: montado aqui para a senha não ir ao navegador */
  app.get(
    '/api/modulos/:id/link',
    rota(async (req, res) => {
      const m = (await modulosDoUsuario()).find((x) => Number(x.id) === id(req.params.id));
      if (!m) throw new ErroApi(404, 'Módulo não encontrado ou não liberado para o seu perfil.');
      const url = String(m.url || '');
      if (!url) throw new ErroApi(400, `O módulo "${m.descricao}" não tem endereço cadastrado.`);
      const user = Buffer.from(String(res.locals.credencial)).toString('base64');
      // O módulo entra direto (sem login) no grupo e na empresa principal do usuário; em erro, volta para o Master
      // (volta = endereço do Master no navegador) com ?erro=<mensagem>
      const [[u]] = await pool.query<Linha[]>('SELECT grupo_id, empresa_id FROM sys_usuarios WHERE id = ?', [usuarioAtual(res).id]);
      const params = new URLSearchParams({ g: String(u.grupo_id), e: String(u.empresa_id), user });
      const volta = String(req.query.volta || '');
      if (/^https?:\/\/[^\s]+$/i.test(volta)) params.set('volta', volta);
      // Tema do Master (light/dark): o módulo abre no mesmo modo
      if (req.query.tema === 'light' || req.query.tema === 'dark') params.set('tema', req.query.tema);
      return { url: `${url}${url.includes('?') ? '&' : '?'}${params}` };
    }),
  );

  // ==========================================================
  // Preferências das listas e formulários (todos os usuários). sys_usuarios.config_listas é compartilhado com o
  // Romaneio e o bm-estoque: o Master usa só a chave "master_listas"
  // ==========================================================
  const CHAVE_LISTAS = 'master_listas';
  const configListas = async (usuarioId: number): Promise<Record<string, unknown>> => {
    const [[u]] = await pool.query<Linha[]>('SELECT config_listas FROM sys_usuarios WHERE id = ?', [usuarioId]);
    try {
      const obj = JSON.parse(String(u?.config_listas || '{}'));
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch {
      return {};
    }
  };
  app.get('/api/config-listas', rota(async (_req, res) => (await configListas(usuarioAtual(res).id))[CHAVE_LISTAS] || {}));
  app.put(
    '/api/config-listas',
    rota(async (req, res) => {
      const corpo = req.body;
      if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroApi(400, 'Configuração inválida.');
      const { id: usuarioId } = usuarioAtual(res);
      const json = JSON.stringify({ ...(await configListas(usuarioId)), [CHAVE_LISTAS]: corpo });
      if (json.length > 60_000) throw new ErroApi(413, 'Configuração muito grande.');
      await pool.query('UPDATE sys_usuarios SET config_listas = ? WHERE id = ?', [json, usuarioId]);
    }),
  );

  // ==========================================================
  // Cadastros: super (tudo) e admin (só o próprio grupo)
  // ==========================================================
  app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    try {
      exigirAdmin(res);
      next();
    } catch (err) {
      res.status((err as ErroApi).status).json({ erro: (err as ErroApi).message });
    }
  });

  app.get(
    '/api/indicadores',
    rota(async (_req, res) => {
      const f = doGrupo(res, 'grupo_id');
      const [[t]] = await pool.query<Linha[]>(
        `SELECT (SELECT COUNT(*) FROM sys_usuarios WHERE ativo = 1 AND ${f.sql}) AS usuarios, (SELECT COUNT(*) FROM sys_empresas WHERE ativo = 1 AND ${f.sql}) AS empresas`,
        [...f.params, ...f.params],
      );
      return { usuarios: Number(t.usuarios), empresas: Number(t.empresas) };
    }),
  );

  /**
   * POST e PUT de grupos, empresas e perfis: só o super grava (o admin só vê). As colunas vêm só de ler(), nunca
   * das chaves do corpo.
   */
  const gravacao = (rotaBase: string, tabela: string, ler: (b: Record<string, unknown>) => Record<string, unknown>) => {
    app.post(
      `/api/${rotaBase}`,
      rota(async (req, res) => {
        exigirSuper(res);
        const [r] = await pool.query<ResultSetHeader>(`INSERT INTO ${tabela} SET ?`, [ler(req.body || {})]);
        return { id: r.insertId };
      }),
    );
    app.put(
      `/api/${rotaBase}/:id`,
      rota(async (req, res) => {
        exigirSuper(res);
        const codigo = id(req.params.id);
        const [r] = await pool.query<ResultSetHeader>(`UPDATE ${tabela} SET ? WHERE id = ?`, [ler(req.body || {}), codigo]);
        if (!r.affectedRows) throw new ErroApi(404, 'Registro não encontrado.');
        return { id: codigo };
      }),
    );
  };
  /** Exclusão lógica (só o super): cadastros do ERP com movimentação não são apagados */
  const inativar = (rotaBase: string, tabela: string) =>
    app.delete(
      `/api/${rotaBase}/:id`,
      rota(async (req, res) => {
        exigirSuper(res);
        const [r] = await pool.query<ResultSetHeader>(`UPDATE ${tabela} SET ativo = 0 WHERE id = ?`, [id(req.params.id)]);
        if (!r.affectedRows) throw new ErroApi(404, 'Registro não encontrado.');
      }),
    );

  // ---------- Grupos (admin: só vê o dele) ----------
  app.get(
    '/api/grupos',
    rota(async (_req, res) => {
      const f = doGrupo(res, 'g.id');
      return (await pool.query<Linha[]>(`SELECT g.id, g.nome, g.ativo, (SELECT COUNT(*) FROM sys_empresas e WHERE e.grupo_id = g.id) AS empresas FROM sys_grupos g WHERE ${f.sql} ORDER BY g.nome`, f.params))[0];
    }),
  );
  gravacao('grupos', 'sys_grupos', (b) => ({ nome: texto(b.nome, 'Nome do grupo', 100, true), ativo: flag(b.ativo) }));
  inativar('grupos', 'sys_grupos');

  // ---------- Configurações dos módulos por grupo (sys_grupos.config, JSON com uma chave por módulo) ----------
  // Super: qualquer grupo; admin: só o dele. Gravar um módulo não mexe nas chaves dos outros.
  const lerConfigGrupo = async (grupoId: number): Promise<Record<string, any>> => {
    const [[g]] = await pool.query<Linha[]>('SELECT config FROM sys_grupos WHERE id = ?', [grupoId]);
    if (!g) throw new ErroApi(404, 'Grupo não encontrado.');
    try {
      const obj = JSON.parse(String(g.config || '{}'));
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch {
      return {};
    }
  };
  /** Valida o que cada módulo grava; módulo novo = entrada nova aqui e aba nova em Configuracoes.tsx */
  const CONFIG_MODULOS: Record<string, (b: Record<string, unknown>) => Record<string, unknown>> = {
    estoque: (b) => {
      const fonte = String(b.imagens_fonte || 'google');
      if (fonte !== 'google' && fonte !== 'serper') throw new ErroApi(400, 'Fonte das imagens inválida.');
      const chave = texto(b.serper_api_key, 'Chave da API Serper', 100);
      if (fonte === 'serper' && !chave) throw new ErroApi(400, 'Informe a chave da API Serper.');
      return { imagens_fonte: fonte, serper_api_key: chave };
    },
  };
  app.get(
    '/api/grupos/:id/config',
    rota(async (req, res) => lerConfigGrupo(grupoPermitido(res, id(req.params.id)))),
  );
  app.put(
    '/api/grupos/:id/config/:modulo',
    rota(async (req, res) => {
      const grupoId = grupoPermitido(res, id(req.params.id));
      const validar = CONFIG_MODULOS[req.params.modulo];
      if (!validar) throw new ErroApi(400, 'Módulo sem configuração.');
      const json = JSON.stringify({ ...(await lerConfigGrupo(grupoId)), [req.params.modulo]: validar(req.body || {}) });
      if (json.length > 60_000) throw new ErroApi(413, 'Configuração muito grande.');
      await pool.query('UPDATE sys_grupos SET config = ? WHERE id = ?', [json, grupoId]);
    }),
  );

  // ---------- Campos das pesquisas do erp-vendas por grupo (ven_pesquisa_campos): só o super ----------
  // O suporte escolhe tabela e coluna em listas; o erp-vendas monta o SQL. Nada digitado vira SQL.
  // Tabelas, campos do sistema e SQL vêm de pesquisaCatalogo.ts, cópia idêntica do arquivo do erp-vendas.
  type TabelaPesquisa = { tabela: string; rotulo: string; alias: string; colunas?: string[] };
  /** Tabelas liberadas por pesquisa (as que o catálogo já junta no FROM) */
  const TABELAS_PESQUISA: Record<string, TabelaPesquisa[]> = Object.fromEntries(
    Object.entries(CATALOGOS).map(([p, c]) => [p, Object.entries(c.tabelas).map(([tabela, t]) => ({ tabela, ...t }))]),
  );
  /**
   * Campos do sistema (os `campos` do catálogo): "Criar Pesquisa" grava um por linha, sem tabela, para o suporte mudar
   * nome, pesquisa e "no grid", ou desligar. `usa` = tabela.coluna que o campo mostra: escolhida no "Novo", grava a
   * linha do campo do sistema (nunca um extra repetido); some da lista de colunas enquanto essa linha existir no grupo.
   */
  type CampoPadrao = { chave: string; label: string; formato?: string; busca?: string; visivel?: boolean; usa?: string };
  const PADRAO_PESQUISA: Record<string, CampoPadrao[]> = Object.fromEntries(
    Object.entries(CATALOGOS).map(([p, c]) => [p, Object.entries(c.campos).map(([chave, f]) => ({ chave, label: f.label, formato: f.formato, busca: f.busca, visivel: f.visivel, usa: f.usa }))]),
  );
  const FORMATOS_PESQUISA = FORMATOS;
  const MODOS_PESQUISA = MODOS;

  const tabelaPesquisa = (pesquisa: unknown, tabela: unknown): TabelaPesquisa => {
    const t = TABELAS_PESQUISA[String(pesquisa)]?.find((x) => x.tabela === tabela);
    if (!t) throw new ErroApi(400, 'Tabela não liberada para esta pesquisa.');
    return t;
  };
  /** Campo do sistema que já mostra esta coluna */
  const doSistema = (pesquisa: string, tabela: string, coluna: string) => PADRAO_PESQUISA[pesquisa]?.find((c) => c.usa === `${tabela}.${coluna}`);
  /** Colunas liberadas; `existentes` = chaves de campos do sistema já gravados no grupo (essas colunas ficam de fora) */
  const colunasPesquisa = async (pesquisa: string, t: TabelaPesquisa, existentes = new Set<string>()) => {
    const [r] = await pool.query<Linha[]>(
      'SELECT column_name AS coluna, data_type AS tipo FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position',
      [t.tabela],
    );
    return r
      .map((x) => {
        const s = doSistema(pesquisa, t.tabela, String(x.coluna));
        return { coluna: String(x.coluna), tipo: String(x.tipo), ...(s && { sistema: s.label, chave: s.chave, formato: s.formato ?? '', busca: s.busca ?? '' }) };
      })
      .filter((c) => !COLUNAS_BLOQUEADAS.test(c.coluna) && (!t.colunas || t.colunas.includes(c.coluna)) && !(c.chave && existentes.has(c.chave)));
  };
  const opcao = (v: unknown, lista: string[], rotulo: string) => {
    const s = String(v ?? '');
    if (s && !lista.includes(s)) throw new ErroApi(400, `${rotulo} inválido.`);
    return s || null;
  };
  const lerCampoPesquisa = async (b: Record<string, unknown>) => {
    const t = tabelaPesquisa(b.pesquisa, b.tabela);
    const coluna = String(b.coluna ?? '');
    const sistema = doSistema(String(b.pesquisa), t.tabela, coluna);
    // Coluna de campo do sistema: grava a linha dele (sem tabela), nunca um campo extra repetido
    if (sistema)
      return {
        pesquisa: String(b.pesquisa),
        chave: sistema.chave,
        tabela: null,
        coluna: null,
        label: texto(b.label, 'Nome na pesquisa', 60, true),
        formato: sistema.formato ?? null,
        busca: sistema.busca ? opcao(b.busca, MODOS_PESQUISA, 'Tipo de pesquisa') : null,
        visivel: flag(b.visivel),
        ativo: flag(b.ativo),
      };
    if (!(await colunasPesquisa(String(b.pesquisa), t)).some((c) => c.coluna === coluna)) throw new ErroApi(400, 'Escolha uma coluna desta tabela.');
    return {
      pesquisa: String(b.pesquisa),
      chave: `${t.alias}_${coluna}`.slice(0, 40),
      tabela: t.tabela,
      coluna,
      label: texto(b.label, 'Nome na pesquisa', 60, true),
      formato: opcao(b.formato, FORMATOS_PESQUISA, 'Formato'),
      busca: opcao(b.busca, MODOS_PESQUISA, 'Tipo de pesquisa'),
      visivel: flag(b.visivel),
      ativo: flag(b.ativo),
    };
  };
  const grupoExiste = async (grupoId: number) => {
    const [[g]] = await pool.query<Linha[]>('SELECT id FROM sys_grupos WHERE id = ?', [grupoId]);
    if (!g) throw new ErroApi(404, 'Grupo não encontrado.');
    return grupoId;
  };

  app.get(
    '/api/pesquisa-campos/tabelas',
    rota(async (_req, res) => {
      exigirSuper(res);
      return Object.fromEntries(Object.entries(TABELAS_PESQUISA).map(([p, l]) => [p, l.map(({ tabela, rotulo }) => ({ tabela, rotulo }))]));
    }),
  );
  app.get(
    '/api/pesquisa-campos/colunas',
    rota(async (req, res) => {
      exigirSuper(res);
      const pesquisa = String(req.query.pesquisa);
      const [r] = await pool.query<Linha[]>('SELECT chave FROM ven_pesquisa_campos WHERE grupo_id = ? AND pesquisa = ? AND tabela IS NULL', [Number(req.query.grupo), pesquisa]);
      return colunasPesquisa(pesquisa, tabelaPesquisa(pesquisa, req.query.tabela), new Set(r.map((x) => String(x.chave))));
    }),
  );
  app.get(
    '/api/grupos/:id/pesquisa-campos',
    rota(async (req, res) => {
      exigirSuper(res);
      const [r] = await pool.query<Linha[]>(
        'SELECT id, pesquisa, chave, tabela, coluna, label, formato, busca, visivel, ativo FROM ven_pesquisa_campos WHERE grupo_id = ? AND pesquisa = ? ORDER BY tabela IS NOT NULL, id',
        [id(req.params.id), String(req.query.pesquisa ?? '')],
      );
      // buscavel: campo do sistema que não pesquisa (ex.: imagem, estoque) não aceita tipo de pesquisa
      return r.map((x) => ({ ...x, buscavel: !!x.tabela || !!PADRAO_PESQUISA[x.pesquisa]?.find((c) => c.chave === x.chave)?.busca }));
    }),
  );
  app.post(
    '/api/grupos/:id/pesquisa-campos',
    rota(async (req, res) => {
      exigirSuper(res);
      const grupoId = await grupoExiste(id(req.params.id));
      const c = await lerCampoPesquisa(req.body || {});
      const [r] = await pool.query<ResultSetHeader>('INSERT INTO ven_pesquisa_campos SET ?, grupo_id = ?, criado_em = NOW(), usuario_id = ?', [c, grupoId, usuarioAtual(res).id]);
      return { id: r.insertId };
    }),
  );
  app.put(
    '/api/grupos/:id/pesquisa-campos/:campo',
    rota(async (req, res) => {
      exigirSuper(res);
      const [[atual]] = await pool.query<Linha[]>('SELECT pesquisa, chave, tabela FROM ven_pesquisa_campos WHERE id = ? AND grupo_id = ?', [id(req.params.campo), id(req.params.id)]);
      if (!atual) throw new ErroApi(404, 'Campo não encontrado.');
      const b = req.body || {};
      // Campo do sistema: só nome, pesquisa (se ele pesquisa), "no grid" e ativo
      const padrao = atual.tabela ? null : PADRAO_PESQUISA[atual.pesquisa]?.find((x) => x.chave === atual.chave);
      const c = padrao
        ? {
            label: texto(b.label, 'Nome na pesquisa', 60, true),
            busca: padrao.busca ? opcao(b.busca, MODOS_PESQUISA, 'Tipo de pesquisa') : null,
            visivel: flag(b.visivel),
            ativo: flag(b.ativo),
          }
        : await lerCampoPesquisa(b);
      await pool.query('UPDATE ven_pesquisa_campos SET ?, atualizado_em = NOW(), usuario_id = ? WHERE id = ?', [c, usuarioAtual(res).id, id(req.params.campo)]);
      return { id: id(req.params.campo) };
    }),
  );
  app.delete(
    '/api/grupos/:id/pesquisa-campos/:campo',
    rota(async (req, res) => {
      exigirSuper(res);
      const [r] = await pool.query<ResultSetHeader>('DELETE FROM ven_pesquisa_campos WHERE id = ? AND grupo_id = ?', [id(req.params.campo), id(req.params.id)]);
      if (!r.affectedRows) throw new ErroApi(404, 'Campo não encontrado.');
    }),
  );
  // SQL da pesquisa: o padrão (gerado do catálogo + campos do grupo) e o próprio do grupo, que o suporte edita.
  // O próprio fica em sys_grupos.config → pesquisas_sql.<pesquisa>; o erp-vendas usa ele no lugar do padrão.
  const catalogoSql = async (grupoId: number, pesquisa: unknown) => {
    const cat = await catalogoDoGrupo(pool, String(pesquisa ?? ''), grupoId);
    if (!cat) throw new ErroApi(400, 'Pesquisa inválida.');
    return cat;
  };
  /** O modelo com os marcadores trocados: uma filial do grupo (a primeira) e a busca de exemplo */
  const sqlFinal = async (grupoId: number, pesquisa: string, sql: string, busca: string) => {
    const erro = validarSqlProprio(sql);
    if (erro) throw new ErroApi(400, erro);
    const cat = await catalogoSql(grupoId, pesquisa);
    const [[e]] = await pool.query<Linha[]>('SELECT id FROM sys_empresas WHERE grupo_id = ? ORDER BY id LIMIT 1', [grupoId]);
    if (!e) throw new ErroApi(400, 'O grupo não tem empresa para testar o SQL.');
    return { cat, empresa: Number(e.id), q: aplicarModelo(sql, cat, busca.slice(0, 100), [], { servico: '0' }, Number(e.id)) };
  };
  /** Roda o SQL (somente leitura) com uma filial do grupo e a busca de exemplo: linhas e colunas do grid que faltam */
  const testarSql = async (grupoId: number, pesquisa: string, sql: string, busca: string) => {
    const { cat, q } = await sqlFinal(grupoId, pesquisa, sql, busca);
    let linhas: unknown[];
    let campos: { name: string }[];
    try {
      [linhas, campos] = (await executarLeitura(pool, q.sql, q.params)) as any;
    } catch (err: any) {
      throw new ErroApi(400, `O SQL não rodou: ${err?.sqlMessage || err?.message || err}`);
    }
    const tem = new Set(campos.map((f) => f.name));
    const faltam = ['id', ...Object.keys(cat.campos)].filter((k) => !tem.has(k)).map((k) => cat.campos[k]?.label ?? k);
    return { linhas: linhas.length, faltam };
  };
  app.get(
    '/api/grupos/:id/pesquisa-sql',
    rota(async (req, res) => {
      exigirSuper(res);
      const grupoId = await grupoExiste(id(req.params.id));
      const cat = await catalogoSql(grupoId, req.query.pesquisa);
      const proprio = (await lerConfigGrupo(grupoId)).pesquisas_sql?.[String(req.query.pesquisa)];
      return { padrao: modeloSql(cat), proprio: typeof proprio === 'string' ? proprio : null };
    }),
  );
  // Raw: o SQL final, com os valores no lugar dos ? (só para ver e copiar; no erp-vendas eles vão como parâmetros)
  app.post(
    '/api/grupos/:id/pesquisa-sql/raw',
    rota(async (req, res) => {
      exigirSuper(res);
      const b = req.body || {};
      const { empresa, q } = await sqlFinal(await grupoExiste(id(req.params.id)), String(b.pesquisa ?? ''), String(b.sql ?? ''), String(b.busca ?? ''));
      let i = 0;
      const sql = q.sql.replace(/\?/g, () => {
        const v = q.params[i++];
        return typeof v === 'number' ? String(v) : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
      });
      return { sql, empresa };
    }),
  );
  app.post(
    '/api/grupos/:id/pesquisa-sql/testar',
    rota(async (req, res) => {
      exigirSuper(res);
      const b = req.body || {};
      return testarSql(await grupoExiste(id(req.params.id)), String(b.pesquisa ?? ''), String(b.sql ?? ''), String(b.busca ?? ''));
    }),
  );
  app.put(
    '/api/grupos/:id/pesquisa-sql',
    rota(async (req, res) => {
      exigirSuper(res);
      const grupoId = await grupoExiste(id(req.params.id));
      const b = req.body || {};
      const pesquisa = String(b.pesquisa ?? '');
      const sql = String(b.sql ?? '').trim();
      // Só grava o que roda: um erro aqui pararia a pesquisa do grupo (o erp-vendas cairia no padrão)
      const teste = await testarSql(grupoId, pesquisa, sql, 'teste');
      if (teste.faltam.includes('id')) throw new ErroApi(400, 'O SQL precisa trazer a coluna id (a chave da linha).');
      const config = await lerConfigGrupo(grupoId);
      const json = JSON.stringify({ ...config, pesquisas_sql: { ...config.pesquisas_sql, [pesquisa]: sql } });
      if (json.length > 60_000) throw new ErroApi(413, 'Configuração muito grande.');
      await pool.query('UPDATE sys_grupos SET config = ? WHERE id = ?', [json, grupoId]);
      return teste;
    }),
  );
  // Voltar Padrão: tira o SQL próprio (o erp-vendas volta a gerar o SQL)
  app.delete(
    '/api/grupos/:id/pesquisa-sql',
    rota(async (req, res) => {
      exigirSuper(res);
      const grupoId = await grupoExiste(id(req.params.id));
      const config = await lerConfigGrupo(grupoId);
      const { [String(req.query.pesquisa)]: _, ...resto } = config.pesquisas_sql ?? {};
      const { pesquisas_sql: __, ...sem } = config;
      await pool.query('UPDATE sys_grupos SET config = ? WHERE id = ?', [JSON.stringify(Object.keys(resto).length ? { ...sem, pesquisas_sql: resto } : sem), grupoId]);
    }),
  );
  // Criar Pesquisa: grava os campos do sistema que faltam no grupo, para o suporte ajustar em vez de digitar um a um
  app.post(
    '/api/grupos/:id/pesquisa-campos/padrao',
    rota(async (req, res) => {
      exigirSuper(res);
      const grupoId = await grupoExiste(id(req.params.id));
      const pesquisa = String(req.query.pesquisa ?? '');
      const campos = PADRAO_PESQUISA[pesquisa];
      if (!campos) throw new ErroApi(400, 'Pesquisa inválida.');
      const usuario = usuarioAtual(res).id;
      // A chave única (grupo, pesquisa, chave) deixa de fora os que já existem
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT IGNORE INTO ven_pesquisa_campos (grupo_id, pesquisa, chave, label, formato, busca, visivel, ativo, criado_em, usuario_id)
         VALUES ${campos.map(() => '(?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?)').join(', ')}`,
        campos.flatMap((c) => [grupoId, pesquisa, c.chave, c.label, c.formato ?? null, c.busca ?? null, c.visivel ? 1 : 0, usuario]),
      );
      return { criados: r.affectedRows };
    }),
  );
  // Voltar ao padrão: apaga os campos do grupo numa pesquisa (o erp-vendas volta a usar só os do sistema, como vêm)
  app.delete(
    '/api/grupos/:id/pesquisa-campos',
    rota(async (req, res) => {
      exigirSuper(res);
      const pesquisa = String(req.query.pesquisa ?? '');
      if (!(pesquisa in TABELAS_PESQUISA)) throw new ErroApi(400, 'Pesquisa inválida.');
      const [r] = await pool.query<ResultSetHeader>('DELETE FROM ven_pesquisa_campos WHERE grupo_id = ? AND pesquisa = ?', [id(req.params.id), pesquisa]);
      return { excluidos: r.affectedRows };
    }),
  );

  // ---------- Empresas (admin: só vê as do grupo dele) ----------
  app.get(
    '/api/empresas',
    rota(async (_req, res) => {
      const f = doGrupo(res, 'e.grupo_id');
      return (
        await pool.query<Linha[]>(
          `SELECT e.id, e.grupo_id, g.nome AS grupo_nome, e.razao_social, e.nome_fantasia, e.cnpj, e.inscricao_estadual, e.inscricao_municipal,
                  e.tipo_atuacao, e.cep, e.logradouro, e.numero, e.complemento, e.bairro, e.cidade, e.uf, e.telefone, e.email, e.ativo
             FROM sys_empresas e LEFT JOIN sys_grupos g ON g.id = e.grupo_id WHERE ${f.sql} ORDER BY e.razao_social`,
          f.params,
        )
      )[0];
    }),
  );
  gravacao('empresas', 'sys_empresas', (b) => {
    const cnpj = limparCnpj(String(b.cnpj ?? ''));
    if (!cnpjValido(cnpj)) throw new ErroApi(400, 'CNPJ inválido: confira os dígitos.');
    const tipo = String(b.tipo_atuacao || '');
    if (!TIPOS_ATUACAO.includes(tipo)) throw new ErroApi(400, 'Informe o tipo de atuação.');
    const uf = String(b.uf || '').toUpperCase();
    if (uf && !UFS.includes(uf)) throw new ErroApi(400, 'UF inválida.');
    const cep = digitos(b.cep, 8);
    if (cep && cep.length !== 8) throw new ErroApi(400, 'O CEP tem 8 dígitos.');
    return {
      grupo_id: id(b.grupo_id, 'Grupo'),
      razao_social: texto(b.razao_social, 'Razão social', 150, true),
      nome_fantasia: opcional(b.nome_fantasia, 'Nome fantasia', 100),
      cnpj,
      inscricao_estadual: opcional(b.inscricao_estadual, 'Inscrição estadual', 20),
      inscricao_municipal: opcional(b.inscricao_municipal, 'Inscrição municipal', 20),
      tipo_atuacao: tipo,
      cep: cep || null,
      logradouro: opcional(b.logradouro, 'Logradouro', 150),
      numero: opcional(b.numero, 'Número', 10),
      complemento: opcional(b.complemento, 'Complemento', 60),
      bairro: opcional(b.bairro, 'Bairro', 80),
      cidade: opcional(b.cidade, 'Cidade', 80),
      uf: uf || null,
      telefone: digitos(b.telefone, 20) || null,
      email: opcional(b.email, 'E-mail', 120),
      ativo: flag(b.ativo),
    };
  });
  inativar('empresas', 'sys_empresas');

  // ---------- Certificados digitais A1 da empresa (super: qualquer empresa; admin: só as do grupo dele) ----------
  // Um por empresa em sys_empresas_certificados, lido pelo erp-nfe e pelo erp-nfs (senha em texto, como eles esperam;
  // só o Master grava). Nenhuma rota devolve o arquivo nem a senha. server/certificado.ts é cópia idêntica do erp-nfe.
  const empresaPermitida = async (res: Response, empresaId: number) => {
    const [[e]] = await pool.query<Linha[]>('SELECT grupo_id FROM sys_empresas WHERE id = ?', [empresaId]);
    if (!e) throw new ErroApi(404, 'Empresa não encontrada.');
    grupoPermitido(res, Number(e.grupo_id));
    return empresaId;
  };
  /** Data do certificado no horário de Brasília, como o MySQL grava ("aaaa-mm-dd hh:mm:ss") */
  const dataBrasilia = (d: Date) => d.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' });

  app.get(
    '/api/empresas/:id/certificado',
    rota(async (req, res) => {
      const empresaId = await empresaPermitida(res, id(req.params.id));
      const [linhas] = await pool.query<Linha[]>(
        `SELECT nome_arquivo, cnpj, razao_social, numero_serie, emissor, valido_de, valido_ate, DATEDIFF(valido_ate, NOW()) AS dias, atualizado_em
           FROM sys_empresas_certificados WHERE empresa_id = ?`,
        [empresaId],
      );
      return { certificado: linhas[0] ?? null };
    }),
  );
  app.put(
    '/api/empresas/:id/certificado',
    rota(async (req, res) => {
      const empresaId = await empresaPermitida(res, id(req.params.id));
      const b = req.body || {};
      const senha = typeof b.senha === 'string' ? b.senha : '';
      if (!senha) throw new ErroApi(400, 'Informe a senha do certificado.');
      const pfx = Buffer.from(String(b.arquivo || ''), 'base64');
      if (!pfx.length) throw new ErroApi(400, 'Escolha o arquivo do certificado (.pfx ou .p12).');
      if (pfx.length > 200_000) throw new ErroApi(400, 'Arquivo grande demais para um certificado A1.');
      const nome = texto(b.nome, 'Nome do arquivo', 160) || 'certificado.pfx';
      let info;
      try {
        info = carregarPfx(pfx, senha).info; // senha errada ou arquivo inválido não chegam ao banco
      } catch (err) {
        throw new ErroApi(400, (err as Error).message);
      }
      await pool.query(
        `INSERT INTO sys_empresas_certificados (empresa_id, nome_arquivo, arquivo, senha, cnpj, razao_social, numero_serie, emissor, valido_de, valido_ate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE nome_arquivo = VALUES(nome_arquivo), arquivo = VALUES(arquivo), senha = VALUES(senha), cnpj = VALUES(cnpj),
           razao_social = VALUES(razao_social), numero_serie = VALUES(numero_serie), emissor = VALUES(emissor),
           valido_de = VALUES(valido_de), valido_ate = VALUES(valido_ate)`,
        [empresaId, nome, pfx, senha, info.cnpj || null, info.razaoSocial.slice(0, 160) || null, info.numeroSerie.slice(0, 80) || null, info.emissor.slice(0, 255) || null, dataBrasilia(info.validoDe), dataBrasilia(info.validoAte)],
      );
    }),
  );
  app.delete(
    '/api/empresas/:id/certificado',
    rota(async (req, res) => {
      const empresaId = await empresaPermitida(res, id(req.params.id));
      const [r] = await pool.query<ResultSetHeader>('DELETE FROM sys_empresas_certificados WHERE empresa_id = ?', [empresaId]);
      if (!r.affectedRows) throw new ErroApi(404, 'Certificado não encontrado.');
    }),
  );

  // ---------- Contas de e-mail da empresa (sys_empresas_smtp; SQL em ../extras/2026-11-24_smtp_*.sql) ----------
  // Uma por finalidade (FINALIDADES_SMTP): o módulo usa a da sua finalidade e, sem ela, a 'padrao'. Lidas pelo erp-nfe
  // (XML/DANFE, inclusive os do erp-pdv) e pelo erp-compras (cotações). Senha em texto, como o certificado (os módulos
  // autenticam com ela); nenhuma rota a devolve. Mesmas permissões do certificado. Excluir apaga (não há movimentação).
  /** Corpo da tela → linha da tabela; senha em branco mantém a gravada (fica de fora) */
  const smtpDoCorpo = (b: any) => {
    const porta = Number(b.porta) || (flag(b.usa_ssl) ? 465 : 587);
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) throw new ErroApi(400, 'Porta inválida.');
    const finalidade = String(b.finalidade || '');
    if (!FINALIDADES_SMTP[finalidade]) throw new ErroApi(400, 'Escolha a finalidade da conta.');
    const senha = typeof b.senha === 'string' && b.senha ? b.senha : undefined;
    if (senha && senha.length > 255) throw new ErroApi(400, 'Senha: no máximo 255 caracteres.');
    return {
      finalidade,
      host: texto(b.host, 'Servidor SMTP', 255, true),
      porta,
      usuario: opcional(b.usuario, 'Usuário', 255),
      remetente: opcional(b.remetente, 'Remetente', 255),
      responder_para: opcional(b.responder_para, 'Responder para', 255),
      usa_ssl: flag(b.usa_ssl),
      usa_tls: flag(b.usa_tls),
      ...(senha !== undefined && { senha }),
    };
  };
  const gravarSmtp = async (req: Request, res: Response, smtpId: number | null) => {
    const empresaId = await empresaPermitida(res, id(req.params.id));
    const s = smtpDoCorpo(req.body || {});
    try {
      if (smtpId === null) {
        await pool.query('INSERT INTO sys_empresas_smtp SET ?, empresa_id = ?', [s, empresaId]);
      } else {
        const [r] = await pool.query<ResultSetHeader>('UPDATE sys_empresas_smtp SET ? WHERE id = ? AND empresa_id = ?', [s, smtpId, empresaId]);
        if (!r.affectedRows) throw new ErroApi(404, 'Conta de e-mail não encontrada.');
      }
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw new ErroApi(400, `Já existe uma conta para ${FINALIDADES_SMTP[s.finalidade]} nesta empresa.`);
      throw err;
    }
  };

  app.get(
    '/api/empresas/:id/smtp',
    rota(async (req, res) => {
      const empresaId = await empresaPermitida(res, id(req.params.id));
      return (
        await pool.query<Linha[]>(
          `SELECT id, finalidade, host, porta, usuario, remetente, responder_para, usa_ssl, usa_tls,
                  senha IS NOT NULL AND senha <> '' AS tem_senha, DATE_FORMAT(atualizado_em, '%Y-%m-%d %H:%i') AS atualizado_em
             FROM sys_empresas_smtp WHERE empresa_id = ? ORDER BY finalidade <> 'padrao', finalidade`,
          [empresaId],
        )
      )[0];
    }),
  );
  app.post('/api/empresas/:id/smtp', rota((req, res) => gravarSmtp(req, res, null)));
  app.put('/api/empresas/:id/smtp/:smtpId', rota((req, res) => gravarSmtp(req, res, id(req.params.smtpId))));
  app.delete(
    '/api/empresas/:id/smtp/:smtpId',
    rota(async (req, res) => {
      const empresaId = await empresaPermitida(res, id(req.params.id));
      const [r] = await pool.query<ResultSetHeader>('DELETE FROM sys_empresas_smtp WHERE id = ? AND empresa_id = ?', [id(req.params.smtpId), empresaId]);
      if (!r.affectedRows) throw new ErroApi(404, 'Conta de e-mail não encontrada.');
    }),
  );
  /** Conecta e autentica com o que está na tela (senha em branco = a gravada da conta `id`), sem enviar e-mail */
  app.post(
    '/api/empresas/:id/smtp/testar',
    rota(async (req, res) => {
      const empresaId = await empresaPermitida(res, id(req.params.id));
      const s = smtpDoCorpo(req.body || {});
      const smtpId = Number(req.body?.id) || 0;
      const senha =
        s.senha ??
        (await pool.query<Linha[]>('SELECT senha FROM sys_empresas_smtp WHERE id = ? AND empresa_id = ?', [smtpId, empresaId]))[0][0]?.senha ??
        '';
      const transporte = nodemailer.createTransport({
        host: s.host,
        port: s.porta,
        secure: !!s.usa_ssl || s.porta === 465,
        requireTLS: !!s.usa_tls && !s.usa_ssl,
        auth: s.usuario ? { user: s.usuario, pass: senha } : undefined,
        connectionTimeout: 15_000,
      });
      try {
        await transporte.verify();
      } catch (err) {
        throw new ErroApi(400, `O servidor recusou a conexão: ${(err as Error).message}`);
      }
    }),
  );

  // ---------- Caixas do PDV da empresa (pdv_caixas; SQL em erp-pdv/code/extras/2026-11-20_pdv_caixas.sql) ----------
  // O token é digitado uma vez no computador do caixa (login do erp-pdv → "Registrar"): daí em diante ele só entra
  // nesta empresa e, com usuário escolhido, só com esse usuário (que também só entra por ele). Excluir inativa.
  /** Token NNNN-NNNN, mesmo formato do erp-pdv (server/caixas.ts) */
  const novoTokenCaixa = () => {
    const s = String(crypto.randomInt(0, 100_000_000)).padStart(8, '0');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  };
  /** Quem entra na empresa pelo PDV: liberados em sys_usuarios_empresas, ou a empresa principal de quem não tem liberação */
  const SQL_USUARIOS_EMPRESA = `
    SELECT u.id, u.login FROM sys_usuarios u
     WHERE u.ativo = 1 AND (u.id IN (SELECT ue.usuario_id FROM sys_usuarios_empresas ue WHERE ue.empresa_id = ?)
        OR (u.empresa_id = ? AND NOT EXISTS (SELECT 1 FROM sys_usuarios_empresas x WHERE x.usuario_id = u.id)))
     ORDER BY u.login`;
  const caixasDa = async (req: Request, res: Response) => {
    exigirAdmin(res);
    return empresaPermitida(res, id(req.params.id));
  };

  app.get(
    '/api/empresas/:id/caixas',
    rota(async (req, res) => {
      const empresaId = await caixasDa(req, res);
      return (
        await pool.query<Linha[]>(
          `SELECT c.id, c.numero, c.descricao, c.usuario_id, u.login, c.token, c.ativo, c.sitef_ip, c.sitef_loja, c.sitef_terminal, c.teclado_virtual,
                  c.balanca, c.balanca_velocidade, c.balanca_formato,
                  DATE_FORMAT(c.registrado_em, '%Y-%m-%d %H:%i') AS registrado_em, DATE_FORMAT(c.ultimo_acesso, '%Y-%m-%d %H:%i') AS ultimo_acesso,
                  ul.login AS ultimo_login, c.ultimo_ip
             FROM pdv_caixas c
             LEFT JOIN sys_usuarios u ON u.id = c.usuario_id
             LEFT JOIN sys_usuarios ul ON ul.id = c.ultimo_usuario_id
            WHERE c.empresa_id = ? ORDER BY c.numero`,
          [empresaId],
        )
      )[0];
    }),
  );
  app.get(
    '/api/empresas/:id/caixas/usuarios',
    rota(async (req, res) => {
      const empresaId = await caixasDa(req, res);
      return (await pool.query<Linha[]>(SQL_USUARIOS_EMPRESA, [empresaId, empresaId]))[0];
    }),
  );
  const gravarCaixa = async (req: Request, res: Response, caixaId: number | null) => {
    const empresaId = await caixasDa(req, res);
    const b = req.body || {};
    const descricao = texto(b.descricao, 'Descrição', 60, true);
    const usuario = b.usuario_id == null || b.usuario_id === '' ? null : id(b.usuario_id, 'Usuário');
    if (usuario !== null) {
      const [us] = await pool.query<Linha[]>(SQL_USUARIOS_EMPRESA, [empresaId, empresaId]);
      if (!us.some((u) => Number(u.id) === usuario)) throw new ErroApi(400, 'Usuário não liberado nesta empresa.');
    }
    // TEF SiTEF do caixa (lido pelo erp-pdv): os três preenchidos ou nenhum; vazio, o cartão é lançado à mão
    const sitef = [opcional(b.sitef_ip, 'Servidor SiTEF', 100), opcional(b.sitef_loja, 'Loja SiTEF', 8), opcional(b.sitef_terminal, 'Terminal SiTEF', 8)];
    if (sitef.some(Boolean) && !sitef.every(Boolean)) throw new ErroApi(400, 'TEF SiTEF: preencha servidor, loja e terminal (ou deixe os três vazios).');
    // Balança de checkout (lida pelo navegador do caixa na porta serial): velocidade e formato do manual da balança
    const velocidade = Number(b.balanca_velocidade) || 2400;
    const formato = String(b.balanca_formato || '8N1').toUpperCase();
    if (![1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].includes(velocidade)) throw new ErroApi(400, 'Balança: velocidade inválida.');
    if (!/^[78][NEO][12]$/.test(formato)) throw new ErroApi(400, 'Balança: formato inválido (ex.: 8N1, 7E1).');
    const balanca = [flag(b.balanca), velocidade, formato];
    if (caixaId !== null) {
      // Token novo desliga o computador registrado com o anterior e fica livre para um registro (o token vale para um
      // computador só: o erp-pdv consome no registro, marcando registrado_em)
      const token = b.novo_token ? novoTokenCaixa() : null;
      const [r] = await pool.query<ResultSetHeader>(
        `UPDATE pdv_caixas SET descricao = ?, usuario_id = ?, ativo = ?, token = COALESCE(?, token),
                registrado_em = IF(? IS NULL, registrado_em, NULL), sitef_ip = ?, sitef_loja = ?, sitef_terminal = ?,
                teclado_virtual = ?, balanca = ?, balanca_velocidade = ?, balanca_formato = ?, atualizado_em = NOW() WHERE id = ? AND empresa_id = ?`,
        [descricao, usuario, flag(b.ativo), token, token, ...sitef, flag(b.teclado_virtual), ...balanca, caixaId, empresaId],
      );
      if (!r.affectedRows) throw new ErroApi(404, 'Caixa não encontrado.');
      return { id: caixaId };
    }
    // Número sequencial na empresa; o índice único (empresa_id, numero) segura duas inclusões ao mesmo tempo
    const [[m]] = await pool.query<Linha[]>('SELECT MAX(numero) AS ultimo FROM pdv_caixas WHERE empresa_id = ?', [empresaId]);
    const [r] = await pool.query<ResultSetHeader>(
      'INSERT INTO pdv_caixas (empresa_id, numero, descricao, usuario_id, token, sitef_ip, sitef_loja, sitef_terminal, teclado_virtual, balanca, balanca_velocidade, balanca_formato, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())',
      [empresaId, (Number(m?.ultimo) || 0) + 1, descricao, usuario, novoTokenCaixa(), ...sitef, flag(b.teclado_virtual), ...balanca],
    );
    return { id: r.insertId };
  };
  app.post('/api/empresas/:id/caixas', rota((req, res) => gravarCaixa(req, res, null)));
  app.put('/api/empresas/:id/caixas/:caixa', rota((req, res) => gravarCaixa(req, res, id(req.params.caixa))));
  app.delete(
    '/api/empresas/:id/caixas/:caixa',
    rota(async (req, res) => {
      const empresaId = await caixasDa(req, res);
      const [r] = await pool.query<ResultSetHeader>('UPDATE pdv_caixas SET ativo = 0, atualizado_em = NOW() WHERE id = ? AND empresa_id = ?', [id(req.params.caixa), empresaId]);
      if (!r.affectedRows) throw new ErroApi(404, 'Caixa não encontrado.');
    }),
  );

  // ---------- Imagens do PDV da empresa (pdv_imagens; SQL em erp-pdv/code/extras/2026-11-20_pdv_imagens.sql) ----------
  // Vitrines do erp-pdv (tela = caixa: tela de venda; cliente: tela do cliente, vertical; SQL 2026-11-21_pdv_imagens_tela.sql):
  // as ativas dentro do período se revezam. A imagem chega em base64 (o Master
  // reduz para WebP antes de enviar) e só sai pela rota da própria imagem, nunca na lista.
  const TIPOS_IMAGEM = ['image/webp', 'image/jpeg', 'image/png'];
  const dataOpcional = (v: unknown, rotulo: string) => {
    const t = String(v ?? '').trim();
    if (!t) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new ErroApi(400, `${rotulo} inválida.`);
    return t;
  };
  app.get(
    '/api/empresas/:id/imagens',
    rota(async (req, res) => {
      const empresaId = await caixasDa(req, res);
      return (
        await pool.query<Linha[]>(
          `SELECT id, titulo, tipo, LENGTH(imagem) AS tamanho, DATE_FORMAT(data_inicio, '%Y-%m-%d') AS data_inicio,
                  DATE_FORMAT(data_fim, '%Y-%m-%d') AS data_fim, ordem, ativo
             FROM pdv_imagens WHERE empresa_id = ? AND tela = ? ORDER BY ordem, id`,
          [empresaId, req.query.tela === 'cliente' ? 'cliente' : 'caixa'],
        )
      )[0];
    }),
  );
  app.get(
    '/api/empresas/:id/imagens/:img',
    rota(async (req, res) => {
      const empresaId = await caixasDa(req, res);
      const [[i]] = await pool.query<Linha[]>('SELECT imagem, tipo FROM pdv_imagens WHERE id = ? AND empresa_id = ?', [id(req.params.img), empresaId]);
      if (!i) throw new ErroApi(404, 'Imagem não encontrada.');
      return { imagem: Buffer.from(i.imagem).toString('base64'), tipo: i.tipo };
    }),
  );
  const gravarImagem = async (req: Request, res: Response, imagemId: number | null) => {
    const empresaId = await caixasDa(req, res);
    const b = req.body || {};
    const titulo = opcional(b.titulo, 'Texto', 100);
    const [inicio, fim] = [dataOpcional(b.data_inicio, 'Data de início'), dataOpcional(b.data_fim, 'Data de fim')];
    if (inicio && fim && fim < inicio) throw new ErroApi(400, 'A data de fim é anterior à de início.');
    const ordem = Number.isInteger(Number(b.ordem)) ? Number(b.ordem) : 0;
    const tela = b.tela === 'cliente' ? 'cliente' : 'caixa';
    // Na edição a imagem é opcional: sem ela, mantém a gravada
    let imagem: Buffer | null = null;
    if (b.imagem) {
      if (!TIPOS_IMAGEM.includes(b.tipo)) throw new ErroApi(400, 'Imagem em formato não aceito (use JPG, PNG ou WebP).');
      imagem = Buffer.from(String(b.imagem), 'base64');
      if (imagem.length > 3 * 1024 * 1024) throw new ErroApi(400, 'Imagem grande demais (máximo 3 MB).');
    } else if (imagemId === null) throw new ErroApi(400, 'Escolha a imagem.');
    if (imagemId !== null) {
      const [r] = await pool.query<ResultSetHeader>(
        `UPDATE pdv_imagens SET titulo = ?, data_inicio = ?, data_fim = ?, ordem = ?, ativo = ?,
                imagem = COALESCE(?, imagem), tipo = IF(? IS NULL, tipo, ?), atualizado_em = NOW() WHERE id = ? AND empresa_id = ?`,
        [titulo, inicio, fim, ordem, flag(b.ativo), imagem, imagem, b.tipo ?? null, imagemId, empresaId],
      );
      if (!r.affectedRows) throw new ErroApi(404, 'Imagem não encontrada.');
      return { id: imagemId };
    }
    const [r] = await pool.query<ResultSetHeader>(
      `INSERT INTO pdv_imagens (empresa_id, tela, titulo, imagem, tipo, data_inicio, data_fim, ordem, ativo, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [empresaId, tela, titulo, imagem, b.tipo, inicio, fim, ordem, b.ativo === undefined ? 1 : flag(b.ativo)],
    );
    return { id: r.insertId };
  };
  app.post('/api/empresas/:id/imagens', rota((req, res) => gravarImagem(req, res, null)));
  app.put('/api/empresas/:id/imagens/:img', rota((req, res) => gravarImagem(req, res, id(req.params.img))));
  // Imagem não tem movimentação: excluir apaga
  app.delete(
    '/api/empresas/:id/imagens/:img',
    rota(async (req, res) => {
      const empresaId = await caixasDa(req, res);
      const [r] = await pool.query<ResultSetHeader>('DELETE FROM pdv_imagens WHERE id = ? AND empresa_id = ?', [id(req.params.img), empresaId]);
      if (!r.affectedRows) throw new ErroApi(404, 'Imagem não encontrada.');
    }),
  );

  // ---------- Desenvolvedor do PAF-NFC-e (sys_paf, uma linha para todo o ERP; lida pelo erp-pdv): só o super ----------
  const CAMPOS_PAF = 'desenvolvedor_razao, desenvolvedor_cnpj, desenvolvedor_ie, desenvolvedor_im, desenvolvedor_endereco, desenvolvedor_telefone, desenvolvedor_responsavel, arq_bd, arq_sist, versao, atualizado_em';
  app.get(
    '/api/desenvolvedor',
    rota(async (_req, res) => {
      exigirSuper(res);
      const [[p]] = await pool.query<Linha[]>(`SELECT ${CAMPOS_PAF} FROM sys_paf WHERE id = 1`);
      return { desenvolvedor: p ?? null };
    }),
  );
  app.put(
    '/api/desenvolvedor',
    rota(async (req, res) => {
      exigirSuper(res);
      const b = req.body || {};
      const cnpj = limparCnpj(String(b.desenvolvedor_cnpj ?? ''));
      if (!cnpjValido(cnpj)) throw new ErroApi(400, 'CNPJ inválido: confira os dígitos.');
      const p = {
        desenvolvedor_razao: texto(b.desenvolvedor_razao, 'Razão social', 50, true),
        desenvolvedor_cnpj: cnpj,
        desenvolvedor_ie: digitos(b.desenvolvedor_ie, 14),
        desenvolvedor_im: digitos(b.desenvolvedor_im, 14),
        desenvolvedor_endereco: texto(b.desenvolvedor_endereco, 'Endereço', 150),
        desenvolvedor_telefone: digitos(b.desenvolvedor_telefone, 20),
        desenvolvedor_responsavel: texto(b.desenvolvedor_responsavel, 'Responsável técnico', 60),
        arq_bd: texto(b.arq_bd, 'Arquitetura do banco', 120, true),
        arq_sist: texto(b.arq_sist, 'Arquitetura do sistema', 120, true),
        versao: texto(b.versao, 'Versão do PAF-NFC-e', 10, true),
      };
      await pool.query('INSERT INTO sys_paf SET ?, id = 1, criado_em = NOW() ON DUPLICATE KEY UPDATE ?, atualizado_em = NOW()', [p, p]);
    }),
  );

  // ---------- Perfis (sem grupo: valem para todos; o admin só lê, para escolher no usuário) ----------
  app.get(
    '/api/perfis',
    rota(async () => (await pool.query<Linha[]>('SELECT p.id, p.nome, p.descricao, (SELECT COUNT(*) FROM sys_usuarios u WHERE u.perfil_id = p.id) AS usuarios FROM sys_perfis p ORDER BY p.nome'))[0]),
  );
  gravacao('perfis', 'sys_perfis', (b) => ({ nome: texto(b.nome, 'Nome do perfil', 60, true), descricao: opcional(b.descricao, 'Descrição', 255) }));
  // Sem coluna ativo: apaga de verdade; em uso por usuário, a chave estrangeira recusa
  app.delete(
    '/api/perfis/:id',
    rota(async (req, res) => {
      exigirSuper(res);
      const [r] = await pool.query<ResultSetHeader>('DELETE FROM sys_perfis WHERE id = ?', [id(req.params.id)]);
      if (!r.affectedRows) throw new ErroApi(404, 'Perfil não encontrado.');
    }),
  );

  // ---------- Usuários (admin: só os do grupo dele, sem mexer em super) ----------
  /** Usuários que o logado vê e altera: o super, todos; o admin, os do grupo dele que não são super */
  const usuariosAlteraveis = (res: Response, prefixo = '') => {
    const f = doGrupo(res, `${prefixo}grupo_id`);
    return usuarioAtual(res).role === 'super' ? f : { sql: `${f.sql} AND ${prefixo}nivel <> 'super'`, params: f.params };
  };

  app.get(
    '/api/usuarios',
    rota(async (_req, res) => {
      const f = usuariosAlteraveis(res, 'u.');
      const [rows] = await pool.query<Linha[]>(
        `SELECT u.id, u.login, u.nome, u.grupo_id, g.nome AS grupo_nome, u.empresa_id, COALESCE(NULLIF(e.nome_fantasia, ''), e.razao_social) AS empresa_nome,
                u.perfil_id, p.nome AS perfil_nome, u.nivel, u.balcao, u.ativo, DATE_FORMAT(u.ultimo_acesso, '%Y-%m-%d %H:%i') AS ultimo_acesso,
                (SELECT GROUP_CONCAT(ue.empresa_id) FROM sys_usuarios_empresas ue WHERE ue.usuario_id = u.id) AS empresas
           FROM sys_usuarios u LEFT JOIN sys_grupos g ON g.id = u.grupo_id LEFT JOIN sys_empresas e ON e.id = u.empresa_id
           LEFT JOIN sys_perfis p ON p.id = u.perfil_id
          WHERE ${f.sql}
          ORDER BY u.login`,
        f.params,
      );
      return rows.map((u) => ({ ...u, empresas: u.empresas ? String(u.empresas).split(',').map(Number) : [] }));
    }),
  );

  /**
   * Grava o usuário e as empresas liberadas (sys_usuarios_empresas) numa transação. A empresa principal e as
   * liberadas precisam ser do grupo do usuário (sys_usuarios.grupo_id).
   */
  const gravarUsuario = async (codigo: number | null, b: Record<string, unknown>, res: Response) => {
    const eu = usuarioAtual(res);
    const nivel = String(b.nivel ?? '') as Nivel;
    if (!NIVEIS.includes(nivel)) throw new ErroApi(400, 'Informe o nível do usuário.');
    if (nivel === 'super' && eu.role !== 'super') throw new ErroApi(403, 'Só o usuário super pode criar outro super.');
    const dados: Record<string, unknown> = {
      nome: texto(b.nome, 'Nome', 150, true),
      login: texto(b.login, 'Login', 60, true),
      grupo_id: grupoPermitido(res, id(b.grupo_id, 'Grupo')),
      empresa_id: id(b.empresa_id, 'Empresa principal'),
      perfil_id: b.perfil_id == null || b.perfil_id === '' ? null : id(b.perfil_id, 'Perfil'),
      nivel,
      // Usuário de balcão (vendedor): no erp-vendas o pedido novo já vem como pré-venda
      balcao: flag(b.balcao),
      ativo: flag(b.ativo),
    };
    if (codigo === eu.id && (nivel !== eu.role || !dados.ativo)) throw new ErroApi(400, 'Você não pode mudar o seu próprio nível nem se inativar.');
    const senha = typeof b.senha === 'string' ? b.senha : '';
    if (senha && senha.trim().length < 4) throw new ErroApi(400, 'A senha precisa ter pelo menos 4 caracteres.');
    // Senha em branco: na inclusão, é definida no primeiro acesso; na edição, não altera
    if (senha) dados.senha_hash = await bcrypt.hash(senha, 10);
    else if (codigo === null) dados.senha_hash = '';
    const empresas = [...new Set((Array.isArray(b.empresas) ? b.empresas : []).map((e) => id(e, 'Empresa')))];
    const usadas = [...new Set([dados.empresa_id as number, ...empresas])];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [doGrupo] = await conn.query<Linha[]>('SELECT id FROM sys_empresas WHERE grupo_id = ? AND id IN (?)', [dados.grupo_id, usadas]);
      if (doGrupo.length !== usadas.length) throw new ErroApi(400, 'A empresa principal e as empresas liberadas precisam ser do grupo do usuário.');
      if (codigo !== null) {
        const f = usuariosAlteraveis(res);
        const [r] = await conn.query<ResultSetHeader>(`UPDATE sys_usuarios SET ? WHERE id = ? AND ${f.sql}`, [dados, codigo, ...f.params]);
        if (!r.affectedRows) throw new ErroApi(404, 'Usuário não encontrado.');
      } else {
        codigo = (await conn.query<ResultSetHeader>('INSERT INTO sys_usuarios SET ?', [dados]))[0].insertId;
      }
      await conn.query('DELETE FROM sys_usuarios_empresas WHERE usuario_id = ?', [codigo]);
      if (empresas.length) await conn.query('INSERT INTO sys_usuarios_empresas (usuario_id, empresa_id) VALUES ?', [empresas.map((e) => [codigo, e])]);
      await conn.commit();
      return { id: codigo };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  };
  app.post('/api/usuarios', rota(async (req, res) => gravarUsuario(null, req.body || {}, res)));
  app.put('/api/usuarios/:id', rota(async (req, res) => gravarUsuario(id(req.params.id), req.body || {}, res)));
  app.delete(
    '/api/usuarios/:id',
    rota(async (req, res) => {
      const codigo = id(req.params.id);
      if (codigo === usuarioAtual(res).id) throw new ErroApi(400, 'Você não pode inativar o seu próprio usuário.');
      const f = usuariosAlteraveis(res);
      const [r] = await pool.query<ResultSetHeader>(`UPDATE sys_usuarios SET ativo = 0 WHERE id = ? AND ${f.sql}`, [codigo, ...f.params]);
      if (!r.affectedRows) throw new ErroApi(404, 'Usuário não encontrado.');
    }),
  );

  // Rota inexistente: JSON, não o index.html do Vite
  app.use('/api', (_req: Request, res: Response) => res.status(404).json({ erro: 'Rota não encontrada.' }));

  return app;
}
