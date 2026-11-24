import React, { useEffect, useState } from 'react';
import { Code2, Copy, FileCode, ListPlus, Loader2, Play, RotateCcw, Save, X } from 'lucide-react';
import { CadastroCrm } from './CadastroCrm';
import { ConfirmDialog } from './ConfirmDialog';
import { AvisoErro, Toast } from './AvisoErro';
import { Campo, INPUT_CLASS } from './FormCrm';
import { Toggle } from './Toggle';
import { abaClasse, abaTexto } from './BarraAbas';
import { simNao } from '../utils/formato';
import { colunasPesquisa, criarPadraoPesquisa, excluirCampoPesquisa, padraoCamposPesquisa, listarCamposPesquisa, salvarCampoPesquisa, lerSqlPesquisa, padraoSqlPesquisa, rawSqlPesquisa, salvarSqlPesquisa, tabelasPesquisa, testarSqlPesquisa, type CampoPesquisa, type ColunaPesquisa } from '../services/api';

/**
 * Campos extras das pesquisas do erp-vendas e do erp-compras (fornecedores) para o grupo (ven_pesquisa_campos; só o super).
 * O suporte escolhe tabela e coluna em listas; o erp-vendas monta o SQL. Lá, o usuário escolhe quais aparecem no grid
 * e em quais pesquisa ("Pesquisar em").
 * "Criar Pesquisa" grava os campos do sistema (linhas sem tabela) para o suporte renomear, mudar a pesquisa ou desligar.
 */

const PESQUISAS = [
  { id: 'produtos', nome: 'Produtos' },
  { id: 'clientes', nome: 'Clientes' },
  { id: 'transportadoras', nome: 'Transportadoras' },
  { id: 'fornecedores', nome: 'Fornecedores' },
];
const FORMATOS: [string, string][] = [['', 'Texto'], ['moeda', 'Moeda'], ['qtd', 'Quantidade'], ['data', 'Data'], ['doc', 'CPF/CNPJ'], ['fone', 'Telefone'], ['simnao', 'Sim/Não']];
const MODOS: [string, string][] = [['', 'Não pesquisa'], ['contem', 'Contém'], ['inicio', 'Começa com'], ['igual', 'Igual'], ['digitos', 'Só os números']];
const FORMATOS_LISTA: [string, string][] = [...FORMATOS, ['imagem', 'Imagem']];
const nomeDe = (lista: [string, string][], v: string | null) => lista.find(([k]) => k === (v ?? ''))?.[1] ?? v ?? '';

interface Form {
  tabela: string;
  coluna: string;
  label: string;
  formato: string;
  busca: string;
  visivel: boolean;
  ativo: boolean;
  /** Campo do sistema: tabela, coluna e formato não mudam */
  sistema: boolean;
  buscavel: boolean;
}

/** nome_fantasia → Nome fantasia */
const rotuloDe = (coluna: string) => {
  const t = coluna.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
/** Formato e pesquisa sugeridos pelo tipo da coluna (o suporte pode trocar) */
const sugestao = (tipo: string): Pick<Form, 'formato' | 'busca'> =>
  /date|time/.test(tipo) ? { formato: 'data', busca: '' }
  : tipo === 'tinyint' ? { formato: 'simnao', busca: '' }
  : /decimal|float|double/.test(tipo) ? { formato: 'qtd', busca: '' }
  : /int/.test(tipo) ? { formato: '', busca: 'igual' }
  : { formato: '', busca: 'contem' };

const CamposForm: React.FC<{ grupoId: number; pesquisa: string; tabelas: { tabela: string; rotulo: string }[]; f: Form; alterar: (p: Partial<Form>) => void }> = ({ grupoId, pesquisa, tabelas, f, alterar }) => {
  const [colunas, setColunas] = useState<ColunaPesquisa[]>([]);
  useEffect(() => {
    setColunas([]);
    if (f.tabela) colunasPesquisa(grupoId, pesquisa, f.tabela).then(setColunas).catch(() => setColunas([]));
  }, [grupoId, pesquisa, f.tabela]);

  const escolherColuna = (coluna: string) => {
    const c = colunas.find((x) => x.coluna === coluna);
    // Coluna de campo do sistema: nome, formato e pesquisa dele (gravar volta o campo do sistema para a lista)
    if (c?.sistema) return alterar({ coluna, label: c.sistema, formato: c.formato ?? '', busca: c.busca ?? '', buscavel: !!c.busca });
    // Nome e formato vêm sugeridos só enquanto o suporte não mexeu neles
    alterar({ coluna, buscavel: true, ...(f.label ? {} : { label: rotuloDe(coluna) }), ...(f.coluna ? {} : sugestao(c?.tipo ?? '')) });
  };
  const doSistema = colunas.find((x) => x.coluna === f.coluna)?.sistema;

  if (f.sistema)
    return (
      <>
        <Campo rotulo="Tabela" dica="Campo do sistema: tabela, coluna e formato vêm do erp-vendas">
          <input disabled value="Sistema" className={INPUT_CLASS} />
        </Campo>
        <Campo rotulo="Formato">
          <input disabled value={nomeDe(FORMATOS_LISTA, f.formato)} className={INPUT_CLASS} />
        </Campo>
        <CamposComuns f={f} alterar={alterar} />
      </>
    );

  return (
    <>
      <Campo rotulo="Tabela">
        <select required value={f.tabela} onChange={(e) => alterar({ tabela: e.target.value, coluna: '' })} className={INPUT_CLASS}>
          {tabelas.map((t) => (
            <option key={t.tabela} value={t.tabela}>
              {t.rotulo}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Coluna" dica={doSistema ? `Campo do sistema "${doSistema}": grava o campo do sistema, não um campo extra` : colunas.find((c) => c.coluna === f.coluna)?.tipo}>
        <select autoFocus={!f.coluna} required value={f.coluna} onChange={(e) => escolherColuna(e.target.value)} className={INPUT_CLASS}>
          <option value="">Escolha…</option>
          {colunas.map((c) => (
            <option key={c.coluna} value={c.coluna}>
              {c.sistema ? `${c.coluna} (campo do sistema: ${c.sistema})` : c.coluna}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Formato">
        <select disabled={!!doSistema} value={f.formato} onChange={(e) => alterar({ formato: e.target.value })} className={INPUT_CLASS}>
          {FORMATOS.map(([k, n]) => (
            <option key={k} value={k}>
              {n}
            </option>
          ))}
        </select>
      </Campo>
      <CamposComuns f={f} alterar={alterar} />
    </>
  );
};

/** Nome, pesquisa, "no grid" e ativo: valem para campo extra e campo do sistema */
const CamposComuns: React.FC<{ f: Form; alterar: (p: Partial<Form>) => void }> = ({ f, alterar }) => (
    <>
      <Campo rotulo="Nome na pesquisa" span={2}>
        <input required autoFocus={f.sistema} maxLength={60} value={f.label} onChange={(e) => alterar({ label: e.target.value })} onFocus={(e) => e.target.select()} className={INPUT_CLASS} />
      </Campo>
      <Campo rotulo="Pesquisa" dica={f.buscavel ? 'Como o texto digitado é comparado; o usuário liga o campo em "Pesquisar em"' : 'Este campo do sistema não é pesquisável'}>
        <select disabled={!f.buscavel} value={f.busca} onChange={(e) => alterar({ busca: e.target.value })} className={INPUT_CLASS}>
          {MODOS.map(([k, n]) => (
            <option key={k} value={k}>
              {n}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Aparece no grid" dica="Para quem ainda não configurou o grid">
        <div className="h-[34px] flex items-center">
          <Toggle checked={f.visivel} onChange={(v) => alterar({ visivel: v })} />
        </div>
      </Campo>
      <Campo rotulo="Ativo" dica={f.sistema ? 'Desligado, o campo sai da pesquisa no erp-vendas' : undefined}>
        <div className="h-[34px] flex items-center">
          <Toggle checked={f.ativo} onChange={(v) => alterar({ ativo: v })} />
        </div>
      </Campo>
    </>
);

const BOTAO = 'shrink-0 inline-flex items-center gap-1.5 h-[34px] px-3 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent';

/**
 * SQL da pesquisa: o padrão (gerado) ou o próprio do grupo, que o suporte edita, testa e grava.
 * Marcadores: :empresa (filial do usuário), {filtros} (filtros da tela), {busca} (condições das palavras digitadas).
 */
const VerSql: React.FC<{ grupoId: number; pesquisa: string; nome?: string; onFechar: () => void }> = ({ grupoId, pesquisa, nome, onFechar }) => {
  const [padrao, setPadrao] = useState('');
  const [proprio, setProprio] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('exemplo');
  /** Raw: o SQL final (marcadores trocados), só leitura; null = editando o modelo */
  const [raw, setRaw] = useState<{ sql: string; empresa: number } | null>(null);
  const [verRaw, setVerRaw] = useState(false);
  const [teste, setTeste] = useState<{ linhas: number; faltam: string[]; busca: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pergunta, setPergunta] = useState<'padrao' | 'descartar' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const carregar = () =>
    lerSqlPesquisa(grupoId, pesquisa)
      .then((r) => {
        setPadrao(r.padrao);
        setProprio(r.proprio);
        setTexto(r.proprio ?? r.padrao);
        setTeste(null);
      })
      .catch((e) => setErro(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- carrega uma vez por grupo/pesquisa
  useEffect(() => void carregar(), [grupoId, pesquisa]);

  const gravado = proprio ?? padrao;
  const alterado = !!padrao && texto !== gravado;
  const fechar = () => (alterado ? setPergunta('descartar') : onFechar());
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !pergunta && fechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  });

  // Raw acompanha a busca de exemplo; um SQL inválido volta para a edição com o erro
  useEffect(() => {
    if (!verRaw) return setRaw(null);
    const t = setTimeout(() => {
      rawSqlPesquisa(grupoId, pesquisa, texto, busca)
        .then(setRaw)
        .catch((e) => {
          setErro(e.message);
          setVerRaw(false);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [verRaw, grupoId, pesquisa, texto, busca]);

  const executar = async (acao: () => Promise<void>) => {
    setOcupado(true);
    try {
      await acao();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro de conexão com o servidor.');
    } finally {
      setOcupado(false);
    }
  };
  const testar = () =>
    executar(async () => {
      setTeste({ ...(await testarSqlPesquisa(grupoId, pesquisa, texto, busca)), busca });
    });
  const salvar = () =>
    executar(async () => {
      const r = await salvarSqlPesquisa(grupoId, pesquisa, texto);
      setProprio(texto.trim());
      setTexto(texto.trim());
      setTeste({ ...r, busca: 'teste' });
      setToast(`SQL próprio da pesquisa de ${nome} gravado: o erp-vendas já usa ele.`);
    });
  const voltarPadrao = async () => {
    await padraoSqlPesquisa(grupoId, pesquisa);
    setPergunta(null);
    setProprio(null);
    setTexto(padrao);
    setTeste(null);
    setToast(`A pesquisa de ${nome} voltou ao SQL padrão.`);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={fechar} aria-hidden="true" />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-6xl h-[90vh] flex flex-col bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10 p-5 gap-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              SQL da pesquisa de {nome}
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${proprio ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'}`}>
                {proprio ? 'SQL próprio deste grupo' : 'SQL padrão'}
              </span>
              {alterado && <span className="text-[10px] font-semibold text-blue-600">alterado, não gravado</span>}
            </h3>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
              A consulta que o erp-vendas roda para este grupo. Marcadores: <code>:empresa</code> = filial do usuário, <code>{'{filtros}'}</code> = filtros da tela, <code>{'{busca}'}</code> = uma condição por
              palavra digitada. As colunas (alias) são as do grid. Com SQL próprio, campo novo cadastrado aqui só aparece depois de incluído no SQL.
            </p>
          </div>
          <button type="button" onClick={fechar} title="Fechar" className="p-1.5 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Abas: SQL (o modelo, editável) e Raw (o SQL final, com os valores no lugar dos marcadores; só leitura) */}
        <div className="flex shrink-0 bg-stone-100 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 rounded-t-md -mb-3">
          {(
            [
              [false, 'SQL', Code2, 'O SQL com os marcadores, para editar'],
              [true, 'Raw', FileCode, 'O SQL final, com a filial e a busca de exemplo no lugar dos marcadores, pronto para rodar num cliente MySQL'],
            ] as const
          ).map(([ehRaw, titulo, Icone, desc]) => (
            <div key={titulo} className={abaClasse(verRaw === ehRaw) + ' px-4'}>
              <button type="button" onClick={() => setVerRaw(ehRaw)} disabled={ehRaw && !texto.trim()} title={titulo} data-dica-desc={desc} className={abaTexto(verRaw === ehRaw)}>
                <Icone className="w-3.5 h-3.5" />
                {titulo}
              </button>
            </div>
          ))}
          {verRaw && raw && (
            <span className="self-center ml-3 text-[11px] text-stone-500 dark:text-stone-400 truncate">
              filial {raw.empresa} no lugar de :empresa e a busca "{busca}" no lugar de {'{busca}'}; só para ver e copiar
            </span>
          )}
        </div>
        <textarea
          readOnly={verRaw}
          value={verRaw ? (raw?.sql ?? 'Montando…') : texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setTeste(null);
          }}
          spellCheck={false}
          wrap="off"
          placeholder="Montando…"
          className={INPUT_CLASS + ' flex-1 min-h-0 !h-auto resize-none font-mono !text-[11px] leading-relaxed whitespace-pre !rounded-t-none' + (verRaw ? ' !bg-stone-50 dark:!bg-stone-950' : '')}
        />
        {teste && (
          <p className={`text-xs ${teste.faltam.length ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
            Rodou: {teste.linhas} linha(s) com a busca "{teste.busca}".
            {teste.faltam.length > 0 && ` Faltam colunas do grid (ficam em branco no erp-vendas): ${teste.faltam.join(', ')}.`}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-stone-600 dark:text-stone-300 shrink-0">Busca de exemplo</label>
          <input value={busca} maxLength={100} onChange={(e) => setBusca(e.target.value)} onFocus={(e) => e.target.select()} className={INPUT_CLASS + ' !w-56'} />
          <button type="button" onClick={testar} disabled={ocupado || !texto.trim()} title="Testar" data-dica-desc="Roda o SQL (só leitura) com uma filial do grupo e a busca de exemplo" className={BOTAO}>
            <Play className="w-3.5 h-3.5" />
            Testar
          </button>
          <button type="button" onClick={() => navigator.clipboard.writeText(verRaw && raw ? raw.sql : texto).then(() => setToast('SQL copiado.'), () => setErro('Não foi possível copiar.'))} title="Copiar" data-dica-desc={verRaw ? 'Copia o SQL final (aba Raw)' : 'Copia o SQL com os marcadores'} className={BOTAO}>
            <Copy className="w-3.5 h-3.5" />
            Copiar
          </button>
          <button type="button" onClick={() => setPergunta('padrao')} disabled={ocupado || !proprio} title="Voltar Padrão" data-dica-desc={proprio ? 'Apaga o SQL próprio deste grupo; o erp-vendas volta a gerar o SQL' : 'Esta pesquisa já usa o SQL padrão'} className={BOTAO}>
            <RotateCcw className="w-3.5 h-3.5" />
            Voltar Padrão
          </button>
          <div className="flex-1" />
          <button type="button" onClick={fechar} className={BOTAO}>
            <X className="w-3.5 h-3.5" />
            Fechar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={ocupado || !alterado}
            title="Salvar"
            data-dica-desc="Testa e grava o SQL como próprio deste grupo"
            className="shrink-0 inline-flex items-center gap-1.5 h-[34px] px-4 rounded-md text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            {ocupado ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar
          </button>
        </div>
      </div>
      {pergunta === 'padrao' && (
        <ConfirmDialog
          titulo="Voltar ao SQL padrão?"
          mensagem={`O SQL próprio da pesquisa de ${nome} deste grupo será apagado e o erp-vendas volta a gerar o SQL. Esta ação não pode ser desfeita.`}
          confirmar="Voltar Padrão"
          onConfirmar={voltarPadrao}
          onCancelar={() => setPergunta(null)}
        />
      )}
      {pergunta === 'descartar' && (
        <ConfirmDialog
          titulo="Descartar as alterações?"
          mensagem="O SQL foi alterado e não foi gravado."
          confirmar="Descartar"
          onConfirmar={onFechar}
          onCancelar={() => setPergunta(null)}
        />
      )}
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {toast && <Toast mensagem={toast} onFechar={() => setToast(null)} />}
    </div>
  );
};

export const PesquisaCampos: React.FC<{ grupoId: number }> = ({ grupoId }) => {
  const [pesquisa, setPesquisa] = useState('produtos');
  const [qtd, setQtd] = useState(0);
  const [versao, setVersao] = useState(0); // muda para recarregar a lista
  const [confirmando, setConfirmando] = useState(false);
  const [vendoSql, setVendoSql] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tabelas, setTabelas] = useState<Record<string, { tabela: string; rotulo: string }[]>>({});
  useEffect(() => {
    tabelasPesquisa().then(setTabelas).catch(() => setTabelas({}));
  }, []);
  const daPesquisa = tabelas[pesquisa] ?? [];
  const rotuloTabela = (t: string) => daPesquisa.find((x) => x.tabela === t)?.rotulo ?? t;
  const nomePesquisa = PESQUISAS.find((p) => p.id === pesquisa)?.nome;

  const criarPesquisa = async () => {
    try {
      const { criados } = await criarPadraoPesquisa(grupoId, pesquisa);
      setVersao((v) => v + 1);
      setToast(criados ? `${criados} campo(s) do sistema criado(s) na pesquisa de ${nomePesquisa}.` : `A pesquisa de ${nomePesquisa} já tem todos os campos do sistema.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro de conexão com o servidor.');
    }
  };

  /** Voltar ao padrão: apaga os campos extras do grupo nesta pesquisa (um erro aparece no diálogo) */
  const voltarAoPadrao = async () => {
    await padraoCamposPesquisa(grupoId, pesquisa);
    setConfirmando(false);
    setVersao((v) => v + 1);
    setToast(`Pesquisa de ${nomePesquisa} voltou ao padrão do sistema.`);
  };

  return (
    <>
      <CadastroCrm<CampoPesquisa, Form>
        key={`${grupoId}-${pesquisa}-${versao}`}
        cadastro="pesquisa_campos"
        embutido
        titulo="Campos das pesquisas"
        subtitulo=""
        registro="Campo"
        fonte={{
          listar: () => listarCamposPesquisa(grupoId, pesquisa),
          salvar: (id, f) => salvarCampoPesquisa(grupoId, id, { ...f, pesquisa }),
          excluir: (id) => excluirCampoPesquisa(grupoId, id),
        }}
        aoCarregar={(l) => setQtd(l.length)}
        barraExtra={
          <>
            <select value={pesquisa} onChange={(e) => setPesquisa(e.target.value)} title="Pesquisa do erp-vendas" className={INPUT_CLASS + ' !w-auto shrink-0'}>
              {PESQUISAS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={criarPesquisa}
              title="Criar Pesquisa"
              data-dica-desc="Grava os campos do sistema desta pesquisa para renomear, mudar a pesquisa ou desligar, sem cadastrar um a um"
              className="shrink-0 inline-flex items-center gap-1.5 h-[34px] px-3 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              <ListPlus className="w-3.5 h-3.5" />
              Criar Pesquisa
            </button>
            <button
              type="button"
              disabled={!qtd}
              onClick={() => setConfirmando(true)}
              title="Voltar ao Padrão"
              data-dica-desc={qtd ? 'Apaga os campos desta pesquisa no grupo; o erp-vendas volta a usar os campos do sistema como vêm' : 'Esta pesquisa já está no padrão do sistema'}
              className="shrink-0 inline-flex items-center gap-1.5 h-[34px] px-3 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Voltar ao Padrão
            </button>
            <button type="button" onClick={() => setVendoSql(true)} title="Ver SQL" data-dica-desc="Mostra e edita a consulta que o erp-vendas roda para este grupo" className={BOTAO}>
              <Code2 className="w-3.5 h-3.5" />
              Ver SQL
            </button>
          </>
        }
        nomeDe={(r) => r.label}
        colunas={[
          { key: 'label', label: 'Nome na pesquisa', largura: 200 },
          { key: 'tabela', label: 'Tabela', largura: 160, render: (r) => (r.tabela ? rotuloTabela(r.tabela) : 'Sistema') },
          { key: 'coluna', label: 'Coluna', largura: 160, render: (r) => r.coluna ?? r.chave },
          { key: 'formato', label: 'Formato', largura: 110, render: (r) => nomeDe(FORMATOS_LISTA, r.formato) },
          { key: 'busca', label: 'Pesquisa', largura: 120, render: (r) => nomeDe(MODOS, r.busca) },
          { key: 'visivel', label: 'No grid', alinhar: 'centro', largura: 80, render: (r) => simNao(r.visivel) },
          { key: 'ativo', label: 'Ativo', alinhar: 'centro', largura: 80, render: (r) => simNao(r.ativo) },
        ]}
        novo={() => ({ tabela: daPesquisa[0]?.tabela ?? '', coluna: '', label: '', formato: '', busca: 'contem', visivel: true, ativo: true, sistema: false, buscavel: true })}
        doRegistro={(r) => ({ tabela: r.tabela ?? '', coluna: r.coluna ?? '', label: r.label, formato: r.formato ?? '', busca: r.busca ?? '', visivel: !!r.visivel, ativo: !!r.ativo, sistema: !r.tabela, buscavel: r.buscavel })}
        validar={(f) => (!f.sistema && !f.coluna ? 'Escolha a coluna.' : !f.label.trim() ? 'Informe o nome na pesquisa.' : null)}
        campos={(f, alterar) => <CamposForm grupoId={grupoId} pesquisa={pesquisa} tabelas={daPesquisa} f={f} alterar={alterar} />}
      />
      {confirmando && (
        <ConfirmDialog
          titulo="Voltar ao padrão?"
          mensagem={`Os ${qtd} campo(s) da pesquisa de ${nomePesquisa} deste grupo serão excluídos e o erp-vendas volta a usar os campos do sistema como vêm. Esta ação não pode ser desfeita.`}
          confirmar="Voltar ao Padrão"
          onConfirmar={voltarAoPadrao}
          onCancelar={() => setConfirmando(false)}
        />
      )}
      {vendoSql && <VerSql grupoId={grupoId} pesquisa={pesquisa} nome={nomePesquisa} onFechar={() => setVendoSql(false)} />}
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {toast && <Toast mensagem={toast} onFechar={() => setToast(null)} />}
    </>
  );
};
